# DNS Detective

An interactive tool that shows how a domain name is resolved, step by step, with real DNS data.


## What it does

Every website has a name (like github.com), but computers find each other by number (an IP address). DNS translates one into the other. DNS Detective lets you type a domain and watch the lookup walk the DNS hierarchy:

1. Your device asks a recursive resolver
2. The resolver asks the root servers
3. The root points to the TLD servers (.com, .org, .in, ...)
4. The TLD points to the domain's authoritative servers
5. The authoritative server returns the final record

## Features

- Real name servers, IP addresses and response times shown at each step
- Query log showing every question asked and every answer received
- Supports A, AAAA, CNAME, MX, NS and TXT records
- Demo cache that shows how TTL and caching skip repeat lookups
- Clear error handling for domains that do not exist (NXDOMAIN)
- Offline demo mode with simulated data
- Plain-language intro and FAQ for people new to DNS

## How it works

The root, TLD and authoritative steps are real DNS-over-HTTPS queries to Cloudflare's public DNS service (`cloudflare-dns.com`), asking for the NS records of each zone. This rebuilds the real delegation chain a lookup follows.

It is not a packet capture. Browsers cannot send raw DNS packets, so the resolver's own internal traffic is not visible.

## Tech

HTML, CSS and vanilla JavaScript.

## Project files

- `index.html`: page structure and content
- `styles.css`: styling
- `app.js`: DNS queries, trace animation, cache and query log
