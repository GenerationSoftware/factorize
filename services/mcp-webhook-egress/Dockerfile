FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod *.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/egress .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates
COPY --from=build /out/egress /usr/local/bin/egress
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/egress"]
