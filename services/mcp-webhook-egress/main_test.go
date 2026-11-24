package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPinnedAddressPreservesTLSHostname(t *testing.T) {
	var callbackCalls atomic.Int32
	callback := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callbackCalls.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != `{"type":"verification","challenge":"one"}` {
			t.Error("the exact webhook body did not reach the callback")
		}
		for name, want := range map[string]string{
			"webhook-id": "event-1", "webhook-timestamp": "42",
			"webhook-signature": "v1,sample", "X-MCP-Subscription-Id": "sub-1",
		} {
			if got := r.Header.Get(name); got != want {
				t.Errorf("%s: got %q, want %q", name, got, want)
			}
		}
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/callback", http.StatusTemporaryRedirect)
			return
		}
		_, _ = io.WriteString(w, `{"challenge":"one"}`)
	}))
	defer callback.Close()
	certificate := callback.Certificate()
	host := certificate.DNSNames[0]
	roots := x509.NewCertPool()
	roots.AddCert(certificate)

	resolved := netip.MustParseAddr("8.8.8.8")
	_, port, err := net.SplitHostPort(callback.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	client := callbackClient(func(_ context.Context, _, name string) ([]netip.Addr, error) {
		if name != host+"." && name != "wrong.test." {
			t.Errorf("unexpected DNS name %q", name)
		}
		return []netip.Addr{resolved}, nil
	}, func(ctx context.Context, network, address string) (net.Conn, error) {
		// Substitute the test listener only after checking the pinned target.
		if address != net.JoinHostPort(resolved.String(), port) {
			t.Errorf("dialed %q with an unpinned destination", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, callback.Listener.Addr().String())
	}, &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12})

	input := delivery{
		URL: "https://" + net.JoinHostPort(host, port) + "/callback",
		ID:  "event-1", Timestamp: "42", Signature: "v1,sample", SubscriptionID: "sub-1",
		Body: `{"type":"verification","challenge":"one"}`, Verify: true,
	}
	if got := send(context.Background(), client, input); got.Status != 200 || got.Challenge != "one" {
		t.Fatalf("verified TLS callback failed: %+v", got)
	}
	input.URL = "https://" + net.JoinHostPort(host, port) + "/redirect"
	if got := send(context.Background(), client, input); got.Status != 307 {
		t.Fatalf("redirect was not returned as its original status: %+v", got)
	}
	input.URL = "https://" + net.JoinHostPort("wrong.test", port) + "/callback"
	if got := send(context.Background(), client, input); got.Status != 0 || got.Reason != "tls_error" {
		t.Fatalf("unmatched TLS hostname was accepted: %+v", got)
	}
	if got := callbackCalls.Load(); got != 2 {
		t.Fatalf("expected exactly two HTTP requests, got %d", got)
	}
}

func TestBlocksPrivateDNSAnswersAndLiterals(t *testing.T) {
	var lookups int
	client := callbackClient(func(context.Context, string, string) ([]netip.Addr, error) {
		lookups++
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("fd00::1")}, nil
	}, func(context.Context, string, string) (net.Conn, error) {
		t.Error("attempted to dial an unvalidated destination")
		return nil, errForbidden
	}, nil)
	for _, url := range []string{
		"https://instance.example.test", "https://127.0.0.1", "https://[::ffff:127.0.0.1]",
		"https://169.254.169.254", "https://[64:ff9b::a00:1]", "https://[2002:a00:1::]",
		"http://8.8.8.8", "https://localhost", "https://example.test/#fragment",
	} {
		if got := send(context.Background(), client, delivery{URL: url}); got.Reason != "forbidden_destination" {
			t.Errorf("%q: unexpected result %+v", url, got)
		}
	}
	if lookups != 1 {
		t.Errorf("expected one hostname lookup, got %d", lookups)
	}
}

func TestEgressRequiresAuthentication(t *testing.T) {
	service := handler("test-auth-token", nil)
	request := httptest.NewRequest(http.MethodPost, "/send", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	service.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated delivery returned %d", response.Code)
	}
}
