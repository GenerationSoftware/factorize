package main

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

const maxBody = 256 * 1024

var (
	errForbidden = errors.New("webhook destination is not public")
	reserved     = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("192.88.99.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"),
		netip.MustParsePrefix("240.0.0.0/4"),
		netip.MustParsePrefix("2001::/23"),
		netip.MustParsePrefix("2001:db8::/32"),
		netip.MustParsePrefix("2002::/16"),
		netip.MustParsePrefix("3fff::/20"),
	}
	globalIPv6 = netip.MustParsePrefix("2000::/3")
)

func publicAddress(address netip.Addr) bool {
	ip := address.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.Zone() != "" || (!ip.Is4() && !globalIPv6.Contains(ip)) {
		return false
	}
	for _, prefix := range reserved {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

type lookupIPs func(context.Context, string, string) ([]netip.Addr, error)
type dialIP func(context.Context, string, string) (net.Conn, error)

func validatedDial(lookup lookupIPs, dial dialIP) dialIP {
	return func(ctx context.Context, network, endpoint string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(endpoint)
		if err != nil {
			return nil, err
		}
		// Absolute DNS names avoid resolver search suffixes. IP literals are
		// validated directly, including IPv4-mapped IPv6.
		var ips []netip.Addr
		if ip, parseErr := netip.ParseAddr(host); parseErr == nil {
			ips = []netip.Addr{ip}
		} else {
			ips, err = lookup(ctx, "ip", strings.TrimSuffix(host, ".")+".")
		}
		if err != nil || len(ips) == 0 {
			return nil, errors.New("webhook hostname resolution failed")
		}
		for _, ip := range ips {
			if !publicAddress(ip) {
				return nil, errForbidden
			}
		}
		for _, ip := range ips {
			connection, err := dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
			if err == nil || ctx.Err() != nil {
				return connection, err
			}
		}
		return nil, errors.New("webhook connection failed")
	}
}

type delivery struct {
	URL            string `json:"url"`
	Body           string `json:"body"`
	ID             string `json:"id"`
	Timestamp      string `json:"timestamp"`
	Signature      string `json:"signature"`
	SubscriptionID string `json:"subscriptionId"`
	Verify         bool   `json:"verify"`
}

type outcome struct {
	Status    int    `json:"status,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Challenge string `json:"challenge,omitempty"`
}

func callbackURL(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil || target.Scheme != "https" || target.Hostname() == "" || target.User != nil || target.Fragment != "" {
		return nil, errForbidden
	}
	host := strings.ToLower(strings.TrimSuffix(target.Hostname(), "."))
	if !strings.ContainsAny(host, ".:") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return nil, errForbidden
	}
	return target, nil
}

func callbackClient(lookup lookupIPs, dial dialIP, config *tls.Config) *http.Client {
	return &http.Client{
		Timeout:       7 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			// Only DialContext is overridden. The HTTPS transport sets SNI and
			// verifies the certificate against the hostname in the request URL.
			DialContext:            validatedDial(lookup, dial),
			TLSClientConfig:        config,
			TLSHandshakeTimeout:    3 * time.Second,
			DisableKeepAlives:      true,
			MaxResponseHeaderBytes: 16 * 1024,
		},
	}
}

func send(ctx context.Context, client *http.Client, input delivery) outcome {
	target, err := callbackURL(input.URL)
	if err != nil {
		return outcome{Reason: "forbidden_destination"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(input.Body))
	if err != nil {
		return outcome{Reason: "forbidden_destination"}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("webhook-id", input.ID)
	req.Header.Set("webhook-timestamp", input.Timestamp)
	req.Header.Set("webhook-signature", input.Signature)
	req.Header.Set("X-MCP-Subscription-Id", input.SubscriptionID)
	response, err := client.Do(req)
	if err != nil {
		var networkError net.Error
		var certificateError *tls.CertificateVerificationError
		switch {
		case errors.Is(err, errForbidden):
			return outcome{Reason: "forbidden_destination"}
		case errors.As(err, &certificateError):
			return outcome{Reason: "tls_error"}
		case errors.As(err, &networkError) && networkError.Timeout():
			return outcome{Reason: "timeout"}
		default:
			return outcome{Reason: "connection_failed"}
		}
	}
	defer response.Body.Close()
	result := outcome{Status: response.StatusCode}
	if input.Verify && result.Status >= 200 && result.Status < 300 {
		var echo struct {
			Challenge string `json:"challenge"`
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
		if err == nil && len(body) <= 4096 && json.Unmarshal(body, &echo) == nil && len(echo.Challenge) <= 128 {
			result.Challenge = echo.Challenge
		}
	}
	return result
}

func handler(token string, client *http.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /send", func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 2*maxBody)
		var input delivery
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !json.Valid([]byte(input.Body)) || len(input.Body) > maxBody {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(send(r.Context(), client, input))
	})
	return mux
}

func main() {
	token := os.Getenv("MCP_EVENT_EGRESS_TOKEN")
	if len(token) < 32 {
		log.Fatal("MCP_EVENT_EGRESS_TOKEN must contain at least 32 characters")
	}
	client := callbackClient(net.DefaultResolver.LookupNetIP, (&net.Dialer{Timeout: 2 * time.Second}).DialContext, &tls.Config{MinVersion: tls.VersionTLS12})
	server := &http.Server{
		Addr:              ":8080",
		Handler:           handler(token, client),
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       15 * time.Second,
		// Avoid logging attacker-controlled request or network error details.
		ErrorLog: log.New(io.Discard, "", 0),
	}
	if server.ListenAndServe() != nil {
		log.Fatal("webhook egress server stopped")
	}
}
