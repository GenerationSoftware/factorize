import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
const receipts = [];
createServer({ key: readFileSync('/fixture-tls/server.key'), cert: readFileSync('/fixture-tls/server.crt') }, async (req, res) => {
  if (req.url === '/receipt' && req.method === 'GET') return res.end(JSON.stringify(receipts));
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) return res.writeHead(413).end(); chunks.push(chunk); }
  const receipt = { credentialMatched: req.headers.authorization === `Bearer ${process.env.EXPECTED_BEARER}`, method: req.method, path: req.url, body: Buffer.concat(chunks).toString() };
  receipts.push(receipt);
  if (!receipt.credentialMatched || receipt.method !== 'POST' || receipt.path !== `/echo/${process.env.MARKER}` || receipt.body !== process.env.MARKER) return res.writeHead(403).end();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ marker: process.env.MARKER }));
}).listen(8443, '0.0.0.0');
