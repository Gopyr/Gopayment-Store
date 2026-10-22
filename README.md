# Gopayment Store

Toko web untuk menjual produk digital dengan pembayaran GoPay QRIS. Store ini memakai source dan API payment gateway dari repository private [Gopayment](https://github.com/Gopyr/Gopayment).

Store mengurus katalog, produk, stok akun, order, dan pengiriman barang digital. Gopayment mengurus pembuatan QRIS, login GoPay Merchant, pengecekan pembayaran, dan callback transaksi.

## Alur aplikasi

1. Pembeli membuka `/store` dan memilih produk.
2. Store membuat order melalui `POST /api/order?action=create`.
3. Store memanggil Gopayment melalui `POST /api/gateway/create`.
4. Gopayment membuat QRIS dinamis dari `QRIS_STRING` merchant dan mengembalikan `paymentUrl`.
5. Pembeli membayar melalui halaman QRIS Gopayment.
6. Gopayment mengecek transaksi melalui akun GoPay Merchant.
7. Setelah pembayaran berhasil, Gopayment mengirim callback ke store.
8. Store menyelesaikan order dan mengirim produk kepada pembeli.

Untuk produk `akun`, satu akun yang belum terjual dipilih secara acak dan ditandai `sold`. Produk `link` dan `file` dikirim dari data produk setelah pembayaran berhasil.

## Struktur project

```text
.
├── api/
│   ├── _admin_auth.js
│   ├── _orders.js
│   ├── _products.js
│   ├── _store.js
│   ├── admin.js
│   ├── admin-products.js
│   ├── catalog.js
│   └── order.js
├── public/
│   ├── admin-products.html
│   └── store.html
├── test/
│   ├── admin.test.mjs
│   ├── order.test.mjs
│   └── store.test.mjs
├── .env.example
├── package.json
└── vercel.json
```

## Database

Data store disimpan di Upstash Redis melalui REST API. `api/_store.js` menyimpan produk, order, mapping sesi pembayaran, session admin, dan rate limit sebagai JSON.

Database yang digunakan project ini saat ini adalah **Upstash Redis**, bukan SQLite. Repository Gopayment menggunakan storage Upstash yang sama untuk data payment gateway.

## Deployment

Deploy kedua project secara terpisah di Vercel.

### 1. Deploy Gopayment

Deploy repository private `Gopyr/Gopayment` terlebih dahulu. Isi environment variable berikut di project Gopayment:

| Variable | Value |
|---|---|
| `GOPAY_EMAIL` | `example@gmail.com` |
| `GOPAY_PASSWORD` | Password akun GoPay Merchant |
| `QRIS_STRING` | String QRIS statis milik merchant |
| `UPSTASH_REDIS_REST_URL` | URL REST database Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST database Upstash Redis |
| `ADMIN_PASSWORD` | Password dashboard admin Gopayment |
| `GATEWAY_API_KEY` | API key yang dipakai store saat memanggil gateway |
| `APP_URL` | URL deployment Gopayment |

`QRIS_STRING` adalah isi mentah QRIS merchant yang biasanya dimulai dengan `000201`. QRIS tersebut menjadi dasar pembuatan QRIS dinamis sesuai nominal order.

### 2. Deploy Gopayment Store

Deploy repository ini setelah URL gateway tersedia. Isi environment variable berikut di project storefront:

| Variable | Value |
|---|---|
| `GOPAYMENT_APP_URL` | URL deployment Gopayment, misalnya `https://gopayment.vercel.app` |
| `GATEWAY_API_KEY` | Nilai yang sama dengan `GATEWAY_API_KEY` di Gopayment |
| `UPSTASH_REDIS_REST_URL` | URL REST database Upstash Redis untuk store |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST database Upstash Redis untuk store |
| `ADMIN_PASSWORD` | Password halaman `/admin-products` |

Setelah variable disimpan, redeploy kedua project.

## Halaman

| Halaman | URL |
|---|---|
| Store | `/` atau `/store` |
| Detail order | `/store#/order/<orderId>` |
| Admin produk | `/admin-products` |
| Admin payment gateway | `/admin` pada project Gopayment |
| Halaman QRIS | `/pay/<sessionId>` pada project Gopayment |

## Endpoint store

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/catalog` | Mengambil katalog publik dan stok. |
| `POST` | `/api/order?action=create` | Membuat order dan sesi pembayaran di Gopayment. |
| `GET` | `/api/order?action=status&orderId=...` | Mengambil status order dan barang yang sudah dibayar. |
| `GET` | `/api/order?action=resolve&sessionId=...` | Mencari order lokal berdasarkan sesi pembayaran. |
| `POST` | `/api/order?action=payhook` | Callback dari Gopayment setelah pembayaran berhasil. |
| `POST` | `/api/admin?action=login` | Login admin store. |
| `GET` | `/api/admin?action=verify` | Memeriksa session admin. |
| `POST` | `/api/admin?action=logout` | Logout admin. |
| `GET` | `/api/admin-products?action=list` | Mengambil semua produk. |
| `POST` | `/api/admin-products?action=create` | Membuat produk. |
| `POST` | `/api/admin-products?action=update` | Mengubah produk. |
| `POST` | `/api/admin-products?action=delete` | Menghapus produk. |
| `POST` | `/api/admin-products?action=add-accounts` | Menambah stok akun secara bulk. |
| `POST` | `/api/admin-products?action=remove-account` | Menghapus satu akun dari stok. |

## Integrasi ke Gopayment

Store mengirim request berikut ke gateway:

```js
const response = await fetch(`${GOPAYMENT_APP_URL}/api/gateway/create`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': GATEWAY_API_KEY,
  },
  body: JSON.stringify({
    nama: product.name,
    tentang: `${product.name} - Order`,
    nominal: product.price,
    callbackUrl: `${STORE_URL}/api/order?action=payhook`,
  }),
});
```

Gateway mengembalikan `sessionId` dan `paymentUrl`. Store menyimpan keduanya pada order dan menampilkan `paymentUrl` kepada pembeli.

Status pembayaran dapat dibaca melalui:

```text
GET ${GOPAYMENT_APP_URL}/api/gateway/status?sessionId=<sessionId>
```

Request status juga memakai header `x-api-key`. Saat pembayaran berhasil, gateway mengembalikan status `success`, `confirmed`, `txId`, dan waktu pembayaran.

Callback dari gateway dikirim ke:

```text
POST https://<domain-store>/api/order?action=payhook
```

Callback memakai header `x-gpayment-signature` yang dibuat dari `GATEWAY_API_KEY`. Payload callback membawa `sessionId`, `txId`, dan waktu pembayaran.

## Produk

### Akun

Produk `akun` memiliki pool akun yang dikelola dari halaman admin. Satu baris berarti satu akun, misalnya:

```text
email1@example.com:password1
email2@example.com:password2
```

Ketika order berhasil dibayar, store memilih satu akun dari pool dan menandainya sebagai `sold`.

### Link

Produk `link` mengirim URL yang disimpan pada field `link` produk. Produk ini dapat dibeli berulang kali.

### File

Produk `file` mengirim `fileUrl` dan `fileName` yang disimpan pada produk. Produk ini dapat dibeli berulang kali.

## Menjalankan test

```bash
npm install
node test/store.test.mjs
node test/order.test.mjs
node test/admin.test.mjs
```

Test order menggunakan gateway mock, sehingga tidak membuat transaksi QRIS sungguhan.

## Menambah produk

1. Buka `/admin-products`.
2. Login menggunakan `ADMIN_PASSWORD` store.
3. Buat produk dengan tipe `akun`, `link`, atau `file`.
4. Untuk produk `akun`, buka pengelolaan akun lalu masukkan satu akun per baris.
5. Produk langsung muncul di katalog setelah disimpan.

