# TODO: UGC Non-Product Content Types

## Overview

Saat ini UGC pipeline hanya support **product** (barang fisik yang dijual).
Goal: support 3 kategori besar konten UGC.

---

## 3 Kategori Besar

### 1. PRODUCT (sudah ada)
Barang fisik yang dijual.
- Contoh: skincare, fashion, gadget, makanan kemasan
- Input: nama/URL produk, product image, harga
- Angle: manfaat, USP, before-after, pain point solved

### 2. PLACE
Tempat / experience yang dikunjungi.
- Contoh: resto, bar, cafe, hotel, outlet, spa, gym, co-working space
- Sub-types: `restaurant` | `bar` | `cafe` | `hotel` | `event`
- Input: nama tempat, lokasi, vibe/ambiance, menu highlight, foto venue
- Angle: FOMO, vibes, social experience, aesthetic, crowd

### 3. PERSON
Orang / brand / service yang di-follow atau dihire.
- Contoh: creator, coach, konsultan, freelancer, SaaS, mobile app
- Sub-types: `personal_brand` | `service` | `app`
- Input: nama, expertise, tagline, USP, foto/screenshot
- Angle: expertise, trust, transformasi, kemudahan, hasil

---

## Yang Perlu Diubah / Ditambah

### Backend

- [ ] **Input schema** — tambah field `contentType: 'product' | 'place' | 'person'` dan sub-type
- [ ] **Script gen system prompt** — buat prompt variant per content type (angle, hook, CTA berbeda)
- [ ] **Research strategy** — `product` → review produk/kompetitor, `place` → Google Maps/viral moment, `person` → niche content/trend
- [ ] **Scene enrichment prompt** — visual direction berbeda per type (product showcase vs venue ambiance vs talking head expertise)
- [ ] **`deepStrategyStreamSchema`** di `ugc.routes.ts` — tambah `contentType` field
- [ ] **`CampaignSession` DB** — tambah kolom `contentType`
- [ ] Update `README.md` di `/src/ai/` setelah implementasi

### Frontend

- [ ] **Step 1 Wizard** — tambah pilihan content type sebelum input produk
- [ ] **Input fields** — conditional berdasarkan content type (venue: nama+lokasi+vibe, person: expertise+tagline)
- [ ] **Label & copy** — ganti "Produk" → dynamic sesuai content type
- [ ] **Avatar/image step** — untuk `place`: foto venue, untuk `person`: foto orang/headshot

---

## Prioritas

1. **PLACE** — paling dekat use case (Akatsa, Holywings, dll) — mulai dari sini
2. **PERSON** — untuk service & personal brand
3. Refinement per sub-type setelahnya

---

## Notes

- Food & Beverage bisa masuk `product` (kalau jual produk) atau `place` (kalau resto/venue)
- Event masuk sub-type `place`
- App/SaaS masuk sub-type `person`
- Jangan breaking change — `product` tetap default, content type lain adalah extension
- **PRODUCT tidak berubah** — selalu `with person`, avatar wajib, tidak ada mode tanpa orang untuk product
