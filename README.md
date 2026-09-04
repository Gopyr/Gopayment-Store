# Gopayment Storefront

Web transaksi untuk menjual **item digital** — **akun (alokasi acak)**, **link**, dan **file** — dengan pembayaran **QRIS** melalui gateway [Gopayment](https://github.com/Gopyr/Gopayment) (repo private). Deploy gratis di **Vercel**.

> Repo ini adalah **lapisan toko (frontend + backend store) terpisah** dari gateway pembayaran.
> Pembayaran QRIS **diserahkan ke repo Gopayment** (private), storefront memanggilnya lewat API gateway.

## ⚠️ Logika backend item: hanya tipe `akun`
- **`akun`** (contoh: akun Freefire): pembeli bayar → backend **memilih 1 akun secara acak** dari stok pool → akun di-mark `sold` dan **tidak bisa dijual lagi**. Stok berkurang.
- **`link` / `file`**: pembeli bayar → langsung dapat link / file. Stok **tidak** berkurang (unlimited).
- Logika alokasi acak & stok **hanya berlaku untuk tipe `akun`**, tidak untuk tipe lain.

## Deploy (2 langkah)

### 1. Deploy gateway dulu (repo Gopayment yang sudah ada)
Pastikan repo private **Gopayment** sudah ter-deploy di Vercel dan env `QRIS_STRING`, `GOPAY_EMAIL`, `GOPAY_PASSWORD`, `UPSTASH_REDIS_*`, `ADMIN_PASSWORD`, `GATEWAY_API_KEY` sudah terisi.

### 2. Deploy repo ini (storefront)
1. Import repo ini di Vercel → **Deploy**.
2. Tambahkan env vars (lihat `.env.example`):
   - `GOPAYMENT_APP_URL` = domain Gopayment (contoh: `https://gopayment.vercel.app`)
   - `GATEWAY_API_KEY` = API key yang **sama** dengan yang di-set di Gopayment
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (bisa shared dengan Gopayment)
   - `ADMIN_PASSWORD`
3. **Redeploy** agar env aktif.

## Halaman
| Halaman | URL |
|---|---|
| Toko (katalog) | `/` atau `/store` |
| Hasil pembelian + QRIS | `/store#/order/:orderId` |
| Admin kelola produk | `/admin-products` |

## Endpoint
| Route | Fungsi |
|---|---|
| `GET /api/catalog` | Daftar produk publik + stok |
| `POST /api/order?action=create` | Buat order + sesi QRIS (via gateway) |
| `GET /api/order?action=status&orderId=` | Poll status order / kirim akun |
| `GET /api/order?action=resolve&sessionId=` | Cari orderId dari session pembayaran |
| `POST /api/order?action=payhook` | Webhook dari gateway saat QRIS terkonfirmasi |
| `GET/POST /api/admin?action=login/verify/logout` | Auth admin (cookie) |
| `GET /api/admin-products?action=list/get` | Admin: lihat produk |
| `POST /api/admin-products?action=create/update/delete` | Admin: CRUD produk |
| `POST /api/admin-products?action=add-accounts` | Admin: tambah stok akun (bulk) |
| `POST /api/admin-products?action=remove-account` | Admin: hapus 1 akun |

## Alur pembelian
1. Pembeli buka `/store`, pilih produk tipe **akun** → **Beli**.
2. Storefront panggil `POST /api/gateway/create` di Gopayment → dapat `paymentUrl` (halaman QRIS). **Stok belum berkurang.**
3. Pembeli klik **Scan QRIS** → terbuka halaman QRIS Gopayment → scan & bayar.
4. Saat QRIS terkonfirmasi di Gopayment, gateway kirim **callback** ke `/api/order?action=payhook` storefront → `orders.fulfill()` → **pilih 1 akun acak**, tandai `sold`, kirim ke pembeli.
5. Halaman `/store#/order/:orderId` polling status → menampilkan akun/link/file saat sukses.

## Verifikasi
Ada 3 suite test (ESM) di `test/` yang dijalankan dengan `node`:
- `store.test.mjs` — logika store + alokasi acak + stok
- `http.test.mjs` — alur endpoint (catalog → order → fulfill)
- `admin.test.mjs` — CRUD admin + auth

```bash
npm install && node test/store.test.mjs && node test/http.test.mjs && node test/admin.test.mjs
```
