# syntax=docker/dockerfile:1
# Lookly API (Go). Build context: apps/api
#   docker build --build-arg VERSION=<version> apps/api

FROM golang:1.26.11-bookworm AS build
WORKDIR /src
# Dependencies first (cached while only sources change); checksums are
# verified against go.sum.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X lookly/internal/app.version=${VERSION}" \
    -o /out/lookly ./cmd/lookly

# Static binary on a minimal, non-root base: no shell, no package manager.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/lookly /lookly
USER nonroot:nonroot
EXPOSE 8080
# The image has no curl: the binary probes itself (exit 0 only on HTTP 200).
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD ["/lookly", "health"]
ENTRYPOINT ["/lookly"]
CMD ["serve"]
