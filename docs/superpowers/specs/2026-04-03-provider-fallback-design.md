# Backend Provider Fallback Design

## Goal

Menambahkan fallback provider di backend `nexoclip-app`: request mencoba OpenRouter terlebih dahulu, lalu memakai API direct milik provider model yang sama ketika OpenRouter mengalami kegagalan sementara.

## Scope

Semua jalur AI yang dikontrol backend dan memakai model Gemini, OpenAI, atau BytePlus, termasuk text/chat, image, video, creative-agent, dan workflow. Fallback untuk job asynchronous hanya dilakukan saat submit awal; polling/download tetap memakai provider dan job ID yang sudah dipilih agar tidak membuat job duplikat.

Model yang tidak memiliki mapping direct provider gagal dengan error terstruktur dan tidak diganti ke model lain.

## Provider mapping

- Model Gemini: OpenRouter → Gemini direct menggunakan `GEMINI_API_KEY`.
- Model OpenAI: OpenRouter → OpenAI direct menggunakan `OPENAI_API_KEY`.
- Model BytePlus: OpenRouter → BytePlus direct menggunakan `BYTEPLUS_API_KEY` dan `BYTEPLUS_BASE_URL`.
- `OPENROUTER_API_KEY` tetap menjadi provider pertama.

Mapping memakai prefix/registry eksplisit sehingga model baru tidak otomatis diarahkan ke provider yang salah. Provider direct harus memakai adapter normalisasi sesuai format endpoint-nya, tetapi mengembalikan bentuk hasil yang sama seperti adapter OpenRouter.

## Fallback policy

Fallback hanya untuk kegagalan transient: network failure, timeout, HTTP 408, 409, 429, dan HTTP 5xx. Error authentication/authorization, model tidak ditemukan, request invalid, content policy, dan error client lain tidak di-fallback.

Jika OpenRouter gagal transient tetapi direct key/base URL tidak tersedia, backend mengembalikan error konfigurasi provider direct yang jelas. Error akhir memuat `code`, `message`, `model`, dan provider yang dicoba, tanpa API key, prompt sensitif, atau response credential.

## Architecture

Buat provider router/service terpusat di `src/providers` yang menerima operasi dan parameter provider-neutral. Router memilih OpenRouter sebagai primary, mengklasifikasikan error, lalu memilih direct adapter sesuai model. Route API yang sekarang membuat adapter OpenRouter langsung diubah untuk memakai router; dependency injection yang sudah dipakai test dipertahankan.

Adapter direct dipisah per provider/operasi bila format API berbeda. BytePlus menggunakan `BYTEPLUS_BASE_URL` sebagai konfigurasi runtime. Streaming harus mempertahankan response stream dari provider yang berhasil dan hanya fallback sebelum stream mulai dikirim.

## Testing

Tambahkan unit test untuk model mapping, transient-vs-permanent error classification, fallback success, direct configuration missing, unsupported model, serta memastikan asynchronous submit hanya dipanggil sekali pada provider yang berhasil. Tambahkan route-level tests dengan fetch/adapter injection untuk jalur image/video/text yang sudah tersedia. Jalankan test suite yang relevan dan build/lint backend.

## Non-goals

Tidak mengganti model secara diam-diam, tidak mengekspos API key ke frontend, tidak menambah fallback berantai ke provider yang bukan pemilik model, dan tidak mengubah status/polling job yang sudah dibuat.
