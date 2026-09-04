# Gopayment Store

Toko jual item digital (akun random / link / file) dengan payment gateway QRIS mandiri.

**100% self-hosted** — jalan di VPS/docker/bare metal. Nggak perlu Vercel, nggak perlu akun DB eksternal.

## Stack

- **Node 24+** (built-in `node:sqlite` DatabaseSync — zero external DB deps)
- **SQLite file** — persisten di `data/store.db`
- **QRIS dynamic** — generate QR dari string statis + GoBiz merchant polling
- **Zero dependencies** (selain `qrcode` untuk gambar QR)

## Fitur

| Feature | Detail |
|---|---|
| **Katalog produk** | List produk publik dengan stok tersedia |
| **Checkout** | Pilih item → bayar QR → dapat akun/link/file |
| **Akun random** | Pool akun per produk, alokasi random saat bayar |
| **Admin CRUD** | Tambah/hapus produk + kelola pool akun |
| **Payment gateway** | QRIS dynamic dari GoPay merchant (GoBiz API) |
| **Callback verification** | HMAC-SHA256 signature dari gateway |

## Arsitektur

```
Pembeli → store.html → POST /api/order
  → generate dynamic QRIS
  → show QR
  → Pembeli scan QR
  → GoPay confirm
  → check-payment.js polls GoBiz
  → POST /api/order/payhook
  → fulfill order (random account allocation)
  → Pembeli lihat hasil pembelian
```

## Setup

```bash
git clone https://github.com/Gopyr/Gopayment-Store.git
cd Gopayment-Store
npm install

cp .env .env.local
# edit .env (minimal QRIS_STRING + GOPAY_EMAIL + GOPAY_PASSWORD)
node server.js
```

Buka `http://localhost:8787` (store) atau `http://localhost:8787/admin-products.html` (admin).

## Env Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | yes | Port server (default 3000) |
| `DATA_DIR` | yes | Direktori untuk `store.db` (SQLite file) |
| `APP_URL` | yes | URL publik app |
| `ADMIN_PASSWORD` | yes | Password admin panel |
| `QRIS_STRING` | yes | String QRIS statis dari GoPay merchant |
| `GOPAY_EMAIL` | yes | Email akun GoPay merchant |
| `GOPAY_PASSWORD` | yes | Password akun GoPay merchant |
| `GOPAY_PIN` | optional | PIN GoPay (untuk konfirmasi transaksi) |
| `GOPAY_TIMEOUT` | no | Detik tunggu polling (default 120) |

## API Endpoints

**Publik:**
- `GET /api/catalog` — list produk aktif
- `POST /api/order?action=create` — buat order + generate QRIS
- `GET /api/order?action=status&orderId=xxx` — cek status order
- `POST /api/order?action=payhook` — callback dari gateway (HMAC verified)
- `GET /api/order?action=resolve&sessionId=xxx` — sessionId → orderId

**Admin:**
- `POST /api/admin?action=login` — login (set cookie `gpayment_admin`)
- `POST /api/admin?action=verify` — cek login status
- `POST /api/admin-products?action=list` — list produk + stok
- `POST /api/admin-products?action=create` — buat produk
- `POST /api/admin-products?action=update` — update produk
- `POST /api/admin-products?action=delete` — hapus produk
- `POST /api/admin-products?action=add-accounts` — bulk add akun ke pool
- `POST /api/admin-products?action=remove-account` — hapus akun dari pool

## Deploy di VPS

```bash
# clone + install
cd /opt/gopayment-store
npm install

# setup .env
cp .env.example .env
nano .env

# run dengan systemd (opsional)
sudo cp gopayment-store.service /etc/systemd/system/
sudo systemctl enable --now gopayment-store

# atau pakai pm2
pm2 start server.js --name gopayment-store
```

## Cara Kerja Random Account

1. Admin tambah akun ke pool via admin panel (`add-accounts`)
2. Pembeli pilih produk → checkout
3. Saat bayar terkonfirmasi, system ambil 1 akun random dari pool (yang belum sold)
4. Akun ke-reveal ke pembeli
5. Akun yang sudah sold tidak akan dipilih lagi

## License

GPL-3.0
