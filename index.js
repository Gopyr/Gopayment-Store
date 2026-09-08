// Entrypoint formal untuk Vercel Node.js Builder
import http from 'node:http';

export default function handler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: "Gopayment Store API is running" }));
}
