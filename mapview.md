# HeatOps — Feature 1: First Map View Page (Build Spec, 0 → Done)

**Scope:** hanya fitur pertama — search lokasi → gambar AOI → translate ke 3D (gedung/rumput/jalan/ground) → panel breakdown % → overlay panas dari FortyGuard di area yang dipilih. Fitur lain (operational analyst, copilot) **belum** disentuh, cuma disiapkan slot navigasinya di sidebar.

**Referensi produk:**
- Image 1 (Autodesk Forma-style): pola sidebar kanan "Analyze" → tombol draw boundary → area metrics (site area, GFA, FAR, efficiency factor, dst) muncul setelah AOI digambar. → kita contek pola *progressive disclosure* ini: panel kanan kosong/disabled sebelum ada AOI, terisi begitu AOI selesai digambar.
- Image 2: overlay warna solid di atas footprint AOI (di gambar ini ungu) menandai zona yang sedang dianalisis/dipilih. → kita pakai pola ini untuk overlay suhu: AOI yang digambar dapat "cat" warna berdasarkan data panas dari FortyGuard, bukan warna flat statis.

> ✅ Handbook sudah dibaca. §5 di bawah sudah pakai endpoint & field **asli** dari FortyGuard, bukan lagi placeholder.

> 🚨 **CONSTRAINT PALING KRITIS — baca ini dulu sebelum apa pun:** FortyGuard API **coverage-nya US-only**. Semua endpoint hanya jalan untuk poligon/titik di dalam Amerika Serikat — di luar itu return error atau hasil kosong. Ini artinya:
> - AOI demo **harus** kota di US (contoh dari handbook: Phoenix, Houston, Miami, New York, San José). Pilih 1 kota untuk jadi AOI demo utama, hard-code sebagai default map center.
> - Kamu di Istanbul, jadi search box default-nya harus langsung fly ke kota US itu, bukan ke lokasi user.
> - Overpass/OSM tetap dipakai untuk land-cover (§5) karena itu sumber terpisah yang memang global, tapi karena AOI-nya toh harus di US, ini otomatis konsisten.
> - Date range data: **2021-01-01 sampai sekarang**, heatmap boleh forecast maksimal **+12 jam** ke depan. Tanggal di luar itu ditolak API.
> - Batas luas AOI untuk `/v1/heatmap`: **~130 km² (50 mi²)**. AOI besar akan direject — jaga AOI demo tetap kecil (beberapa blok/kompleks industri), bukan sekelas kota.

---

## 1. Definition of Done (fitur ini dianggap selesai kalau...)

- [ ] User bisa search nama lokasi/alamat → map fly ke lokasi itu
- [ ] User bisa gambar AOI (polygon/box) di atas map
- [ ] Setelah AOI selesai digambar, scene otomatis render 3D: gedung terekstrusi (tinggi asli dari data), area rumput/vegetasi berwarna hijau, jalan/ground berwarna sesuai kategori
- [ ] Panel kanan menampilkan breakdown %: bangunan / rumput / jalan-perkerasan / air / lainnya, dari luas AOI
- [ ] User bisa toggle overlay panas → AOI ter-"cat" gradasi warna berdasarkan data temperatur FortyGuard (bukan warna flat)
- [ ] Ada badge sumber data di tiap angka: **Real** (dari API) / **Estimated** / **Simulated**
- [ ] Sidebar kiri berisi navigasi ke 3 fitur besar (Map View aktif, Operational Analyst & AI Copilot ditandai "coming soon"/disabled)
- [ ] Semua di atas jalan dengan AOI kecil (± beberapa blok), tidak perlu skala kota

---

## 2. Layout halaman

```
┌────────┬──────────────────────────────────────────┬──────────────┐
│        │  🔍 Search location...                     │  ANALYZE      │
│ SIDEBAR│  ┌────────────────────────────────────┐   │ ────────────  │
│        │  │                                      │   │ [Draw AOI]    │
│ ▣ Map  │  │        MAP (2D → 3D on draw)         │   │               │
│   View │  │                                      │   │ Area metrics  │
│        │  │  [draw tool] [3d toggle] [heat toggle]│   │ (disabled     │
│ ○ Op.  │  │                                      │   │  until AOI    │
│  Analyst│  │                                      │   │  drawn)       │
│ (soon) │  │                                      │   │               │
│        │  │                                      │   │ Site area: -  │
│ ○ AI   │  │                                      │   │ Buildings: -% │
│  Copilot│  └────────────────────────────────────┘   │ Grass: -%     │
│ (soon) │                                              │ Road: -%      │
│        │                                              │ Water: -%     │
└────────┴──────────────────────────────────────────┴──────────────┘
```

Setelah AOI digambar → panel kanan terisi live, badge attribution muncul di tiap baris angka (mengikuti prinsip HeatOps awal: real/estimated/simulated).

---

## 3. Component breakdown (Next.js + TypeScript)

```
apps/web/
├─ app/
│  └─ map/
│     └─ page.tsx                  # halaman utama fitur 1
├─ components/
│  ├─ sidebar/
│  │  └─ AppSidebar.tsx            # nav 3 fitur, item non-aktif disabled
│  ├─ map/
│  │  ├─ MapCanvas.tsx             # MapLibre + deck.gl root
│  │  ├─ SearchBox.tsx             # geocoding search (Nominatim/OSM)
│  │  ├─ DrawAOIControl.tsx        # draw polygon/box tool
│  │  ├─ BuildingLayer.tsx         # deck.gl GeoJsonLayer extruded
│  │  ├─ LandcoverLayer.tsx        # grass/water/road polygons berwarna
│  │  ├─ HeatOverlayLayer.tsx      # gradasi warna dari FortyGuard grid
│  │  └─ ViewModeToggle.tsx        # 2D <-> 3D, heat on/off
│  └─ panel/
│     ├─ AnalyzePanel.tsx          # panel kanan, container
│     ├─ AreaMetricCard.tsx        # 1 baris metric + attribution badge
│     └─ AttributionBadge.tsx      # "Real" / "Estimated" / "Simulated"
├─ lib/
│  ├─ overpass.ts                  # fetch + parse building/landuse dari Overpass
│  ├─ landcover.ts                 # hitung % area per kategori (turf.js)
│  ├─ fortyguard.ts                # client: submit job, poll status, ambil grid
│  └─ geocode.ts                   # search lokasi (Nominatim)
├─ app/api/
│  ├─ heat/submit/route.ts         # proxy submit job ke FortyGuard (sembunyikan API key)
│  ├─ heat/status/[jobId]/route.ts # proxy poll status
│  └─ landcover/route.ts           # proxy Overpass + hitung % (server-side, cache)
└─ store/
   └─ aoiStore.ts                  # Zustand: AOI geometry, status, hasil analisis
```

---

## 4. Alur data (step by step, ini urutan render-nya)

1. **Search** → `geocode.ts` (Nominatim) → map `flyTo(lng, lat, zoom)`
2. **Draw AOI** → user gambar polygon di map (mapbox-gl-draw / deck.gl editable layer) → geometry disimpan di `aoiStore`
3. Begitu AOI selesai (event `draw.create`):
   - a. Panggil `/api/landcover` dengan geometry AOI → server: query Overpass (`building`, `landuse=grass|forest`, `natural=water`, `highway`) dibatasi bounding box AOI → clip tiap polygon ke AOI pakai turf.js → hitung luas per kategori → return `{ buildings: {areaM2, pct}, grass: {...}, road: {...}, water: {...}, other: {...} }` + `attribution: "real"` (karena dari OSM asli)
   - b. Panggil `/api/heat/submit` dengan geometry AOI → dapat `jobId` → poll `/api/heat/status/[jobId]` tiap 2-3 detik (pakai React Query `refetchInterval`) sampai status `done` → hasil: grid titik temperatur dalam AOI
4. **Render 3D**: `BuildingLayer` pakai hasil (3a) — tiap building polygon di-extrude tinggi dari tag `building:levels` (× ~3m per lantai, default 1 lantai kalau tag kosong — tandai `estimated` kalau default dipakai)
5. **Render land cover warna**: `LandcoverLayer` — grass hijau, road abu-abu, water biru, ground/other krem
6. **Render heat overlay** (toggle): `HeatOverlayLayer` — interpolasi grid titik FortyGuard (3b) jadi gradasi warna di atas AOI (mis. `HeatmapLayer` deck.gl atau `ContourLayer`), skala warna biru→merah
7. **Panel kanan** render tiap `AreaMetricCard` dari hasil (3a) + (3b), tiap card ada `AttributionBadge`

---

## 5. Kontrak API (asli, dari handbook FortyGuard)

### FortyGuard — real spec

- **Base URL:** `https://api.fortyguard.com`
- **Auth header:** `api-key: YOUR_API_KEY` (+ `Content-Type: application/json`)
- **Pola async:** POST endpoint analisis → dapat `activity_id` di response → poll `GET /v1/status/{activity_id}` sampai status terminal (`succeeded`/`completed` → hasil ada di `data.result`; `failed`/`error` → gagal, **tidak makan credit**)
- **Poll dengan backoff**, jangan interval tetap: 3s → 6s → 12s (rekomendasi resmi handbook)
- **Endpoint yang relevan untuk fitur 1:**
  | Endpoint | Fungsi | Plan |
  |---|---|---|
  | `POST /v1/heatmap` | tile-by-tile thermal map di atas polygon AOI — **ini yang dipakai untuk heat overlay** | All plans |
  | `POST /v1/env_params` | heat index, AQI, solar irradiance di satu titik — dipakai untuk kartu "Environmental context" di panel kanan (humidity, AQI, solar) | All plans |
  | `POST /v1/satellite` | segmentasi land-cover dari citra satelit (greenery, roads, buildings) — **kamu punya akses Premium, jadi ini jadi sumber % land-cover UTAMA** menggantikan Overpass untuk angka persentase | Premium ✅ tersedia |
  | `GET /v1/system/fetch-api-key-usage` | cek sisa credit | All plans |
  | `GET /v1/status/{activity_id}` | poll status/hasil task manapun | All plans |

  → **Pembagian tugas final:**
  - **Overpass (OSM)** → cuma untuk geometri vektor bangunan (footprint + `building:levels` untuk tinggi ekstrusi 3D). Ini dibutuhkan karena `/v1/satellite` tidak kasih polygon per-bangunan dengan tinggi, cuma klasifikasi pixel.
  - **`/v1/satellite`** → sumber angka %-breakdown "Real" utama (buildings/greenery/roads dari AI FortyGuard sendiri). Ini juga memperkuat cerita submission karena benar-benar pakai FortyGuard, bukan cuma OSM.
  - **`/v1/env_params`** → data tambahan (heat index, AQI, solar irradiance) di titik tengah AOI, ditampilkan sebagai kartu ekstra di panel kanan, badge "Real".
  - Kalau `/v1/satellite` dan Overpass hasilnya beda cukup jauh untuk kategori yang sama, tampilkan yang dari `/v1/satellite` sebagai angka utama dan Overpass sebagai cross-check di tooltip — jangan rata-rata keduanya (biar sumbernya tetap jelas per angka).

### `POST /v1/heatmap` — request body asli

```json
{
  "polygon_aoi": {
    "type": "FeatureCollection",
    "features": [{
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-74.017, 40.705], [-74.003, 40.705],
          [-74.003, 40.718], [-74.017, 40.718],
          [-74.017, 40.705]
        ]]
      }
    }]
  },
  "date_time": {
    "start_date": "2026-08-20",
    "start_time": "14:00",
    "filter_type": 3
  },
  "granularity": 100
}
```

Catatan field:
- `polygon_aoi` koordinatnya **[longitude, latitude]**, titik pertama = titik terakhir (ring harus tertutup)
- `date_time.filter_type`: `1` = 1 jam spesifik, `2` = range jam (perlu `end_time`), `3` = 1 hari penuh (paling pas untuk panel "breakdown harian"), `4` = range hari, `5` = 1 bulan
- `granularity`: `60`/`80`/`100` meter — makin kecil makin detail tile-nya, tapi makin mahal credit. **Mulai dari 100 dulu** buat development, baru turunkan kalau perlu makin presisi untuk demo final.

### Response (setelah polling selesai)

```json
// POST /v1/heatmap -> langsung dapat activity_id
{ "activity_id": "abc123" }

// GET /v1/status/abc123 -> saat masih proses
{ "status": "pending" }

// GET /v1/status/abc123 -> saat selesai
{
  "status": "succeeded",
  "data": {
    "result": {
      "stats_data": { "...": "..." },
      "tiles": [ { "lat": 40.706, "lng": -74.015, "tempC": 34.2 }, ... ]
    }
  }
}
```

> Field persis di dalam `data.result` (nama tile, struktur stats) belum kelihatan lengkap di handbook ini — begitu quickstart repo (Python+Jupyter, notebook 01) dijalankan, `print(response["result"]["stats_data"])` akan kasih bentuk asli. **Jalankan quickstart notebook 01 dulu di cached mode (tanpa API key) sebelum ngoding `lib/fortyguard.ts`**, supaya kamu tahu persis shape JSON-nya, bukan nebak dari sini.

### `POST /api/heat/submit` & `/api/heat/status/:jobId` (proxy internal kamu)

Route Next.js kamu **membungkus** FortyGuard di atas, supaya API key tidak bocor ke browser dan supaya kamu bisa cache di Supabase:

```json
// POST /api/heat/submit  (request ke server kamu)
{ "aoi": { "type": "Polygon", "coordinates": [...] }, "date": "2026-08-20", "hour": "14:00" }
// response
{ "jobId": "abc123" }   // ini activity_id FortyGuard, diteruskan apa adanya
```

```json
// GET /api/heat/status/:jobId
{ "status": "pending" }
// atau
{ "status": "done", "data": { "tiles": [ { "lat": .., "lng": .., "tempC": 34.2 } ] } }
```

### `POST /api/landcover`
```json
// request
{ "aoi": { "type": "Polygon", "coordinates": [...] } }
// response
{
  "siteAreaM2": 48200,
  "breakdown": {
    "buildings": { "areaM2": 12300, "pct": 25.5, "attribution": "real" },
    "grass":     { "areaM2": 14500, "pct": 30.1, "attribution": "real" },
    "road":      { "areaM2": 9800,  "pct": 20.3, "attribution": "real" },
    "water":     { "areaM2": 2100,  "pct": 4.4,  "attribution": "real" },
    "other":     { "areaM2": 9500,  "pct": 19.7, "attribution": "estimated" }
  }
}
```

Kalau nanti handbook FortyGuard kasih nama endpoint/field beda, cukup ubah isi `lib/fortyguard.ts` + route di atas — komponen frontend tidak perlu berubah karena semua konsumsi lewat kontrak JSON ini.

---

## 5b. Cara jalankan Temperature API Quickstart (sebelum ngoding lib/fortyguard.ts)

Lakukan ini dulu, sebelum step 5 di §7 — supaya kamu lihat bentuk asli JSON `data.result` untuk `/v1/heatmap`, `/v1/satellite`, dan `/v1/env_params`, bukan tebakan dari handbook.

1. **Ambil link repo quickstart** — dibagikan saat registrasi hackathon dan di-pin di Slack channel FortyGuard Hackathon'26. Kalau belum ketemu, cek email registrasi atau tanya di `#help-technical`.
2. **Clone & setup:**
   ```
   git clone <quickstart-repo-url> temperature-api-quickstart
   cd temperature-api-quickstart
   python -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   cp .env.example .env
   ```
3. **Isi API key** di file `.env` yang baru dibuat:
   ```
   FORTYGUARD_API_KEY=fg_live_xxxxxxxxxxxxxxxxx
   ```
   (ambil key dari tab Profile di dashboard.fortyguard.com — kamu generate sendiri, jangan hardcode di kode, jangan commit `.env`)
4. **Jalankan Jupyter:**
   ```
   jupyter lab
   ```
5. **Urutan notebook yang perlu kamu jalankan untuk fitur 1:**
   - `00_setup.ipynb` — cek auth + sisa credit jalan dulu
   - `01_heatmap.ipynb` — heatmap pertamamu, run all cells, lihat bentuk `response["result"]["stats_data"]` dan struktur tile-nya persis
   - `03_satellite.ipynb` — karena kamu Premium, jalankan ini juga untuk lihat bentuk response segmentasi land-cover (field apa saja yang dikembalikan untuk % buildings/greenery/roads)
   - `02_env_params.ipynb` — opsional tapi cepat, buat lihat shape heat index/AQI/solar
6. **Tips dari handbook:** semua notebook bisa jalan tanpa API key dulu pakai `CACHED=True` (pakai response contoh yang sudah di-bundle) — kalau mau tes struktur data secepatnya sebelum key kamu aktif, mulai dari situ. Begitu key aktif, set `CACHED=False` supaya notebook mulai submit request sungguhan.
7. Setelah lihat bentuk JSON asli dari 01 dan 03, **baru** lanjut nulis `lib/fortyguard.ts` — sesuaikan parsing-nya persis dengan field yang benar-benar muncul, bukan nama field yang saya tulis di §5 (itu masih rekonstruksi dari deskripsi handbook, bukan raw response).

## 6. Rencana 2 hari



**Hari 1 — pipeline data + 2D dulu (skip 3D dulu, jangan langsung loncat ke 3D)**
- [ ] Setup Next.js + Tailwind + MapLibre, render map kosong
- [ ] `SearchBox` + geocoding jalan
- [ ] Draw AOI tool jalan, geometry tersimpan di store
- [ ] `/api/landcover` jalan end-to-end pakai data Overpass asli → panel kanan menampilkan angka % real (belum ada 3D, cukup lihat angka dulu — ini validasi paling penting)
- [ ] `/api/heat/submit` + `/api/heat/status` jalan end-to-end dengan FortyGuard asli (pakai AOI kecil sebagai test) — ini risiko terbesar, kerjakan paling awal di hari 1, jangan ditunda

**Hari 2 — 3D + overlay + polish**
- [ ] `BuildingLayer` deck.gl extrusion dari hasil Overpass
- [ ] `LandcoverLayer` warna per kategori
- [ ] `HeatOverlayLayer` dari grid FortyGuard
- [ ] Toggle 2D/3D, toggle heat on/off
- [ ] Attribution badge di semua angka
- [ ] Sidebar dengan 3 menu (2 disabled)
- [ ] Cache 1-2 AOI demo di server (biar saat presentasi tidak nunggu polling FortyGuard live)

---

## 7. Prompt awal untuk AI coding agent (Claude Code / Cursor)

Pakai prompt ini sebagai instruksi pertama begitu mulai coding:

```
Saya membangun HeatOps, fitur pertama: "Map View" page, untuk FortyGuard
Hackathon'26 (deadline submit 30 Agustus 2026, 11:59 PM GST).

Stack: Next.js 14 (App Router) + TypeScript + Tailwind + MapLibre GL JS +
deck.gl + Turf.js + Zustand + React Query + Supabase (Postgres + Storage).
Deploy target: Vercel.

KONSTRAIN PENTING dari FortyGuard API — WAJIB dipatuhi di semua kode:
- Coverage API cuma US-only. AOI demo harus di kota AS (pakai [KOTA_PILIHAN,
  isi salah satu: Phoenix/Houston/Miami/New York/San Jose] sebagai default
  map center & search fallback), bukan lokasi saya di Istanbul.
- Base URL: https://api.fortyguard.com, auth via header "api-key", request
  body JSON.
- Endpoint utama: POST /v1/heatmap (submit) -> dapat activity_id -> poll
  GET /v1/status/{activity_id} sampai status succeeded/failed. Poll dengan
  backoff 3s -> 6s -> 12s, jangan interval tetap.
- date_time.start_date dibatasi 2021-01-01 s/d sekarang, forecast maks +12
  jam. filter_type=3 untuk breakdown 1 hari penuh.
- granularity heatmap: 60/80/100 meter, mulai dari 100 saat development.
- AOI heatmap dibatasi ~130 km² (50 mi^2) -- AOI demo harus kecil (beberapa
  blok), bukan seluas kota.
- /v1/satellite (land segmentation) itu Premium plan -- saya PUNYA akses ini,
  jadi pakai /v1/satellite sebagai sumber % land-cover UTAMA (buildings/
  greenery/roads), dan Overpass API cuma untuk geometri vektor bangunan
  (footprint + tinggi) yang dibutuhkan buat ekstrusi 3D di deck.gl, karena
  /v1/satellite tidak kasih polygon per-bangunan.
- Tambahkan juga /v1/env_params (heat index, AQI, solar irradiance di titik
  tengah AOI) sebagai kartu tambahan di panel kanan.
- Failed task di FortyGuard tidak makan credit -- selalu wrap try/except dan
  log activity_id untuk debugging.
- SEBELUM nulis lib/fortyguard.ts, jalankan dulu FortyGuard Temperature API
  Quickstart (Python+Jupyter, notebook 01) dalam cached mode untuk lihat
  bentuk asli response JSON-nya, jangan nebak shape dari dokumentasi saja.

Bangun fitur ini step by step, JANGAN loncat ke 3D sebelum data pipeline
2D-nya jalan dan tervalidasi:

STEP 1 — Setup & shell
- Inisialisasi Next.js + Tailwind
- Buat AppSidebar dengan 3 item nav: "Map View" (aktif), "Operational
  Analyst" (disabled, badge "Soon"), "AI Copilot" (disabled, badge "Soon")
- Buat halaman /map dengan layout 3 kolom: sidebar | map canvas | analyze panel

STEP 2 — Map dasar + search
- Render MapLibre GL map (style gratis, mis. OpenFreeMap atau MapTiler free tier)
- Buat SearchBox yang query Nominatim (OpenStreetMap geocoding, gratis, tanpa
  API key) dan flyTo hasil pertama

STEP 3 — Draw AOI
- Tambahkan draw tool (polygon) di atas map, simpan geometry AOI ke
  Zustand store (aoiStore.ts)
- Saat AOI selesai digambar, trigger fetch ke step berikutnya

STEP 4 — Land cover breakdown (2D dulu, prioritas tertinggi)
- Buat API route /api/landcover: terima AOI geometry, panggil dua sumber
  paralel:
  (a) FortyGuard /v1/satellite (submit + poll seperti /v1/heatmap) untuk
      dapat % buildings/greenery/roads dari segmentasi AI FortyGuard --
      ini jadi sumber "Real" utama untuk angka breakdown
  (b) Overpass API untuk building/landuse/highway/water polygon dalam
      bounding box AOI, clip ke AOI pakai Turf.js -- dipakai untuk geometri
      3D (step 6), dan sebagai cross-check kalau (a) meleset jauh
- Tampilkan hasil (a) di AnalyzePanel sebagai AreaMetricCard dengan
  AttributionBadge "Real (FortyGuard)"
- Validasi: angka % harus masuk akal dan total mendekati 100%

STEP 5 — FortyGuard heat data
- Buat API route /api/heat/submit yang POST ke https://api.fortyguard.com/v1/heatmap
  dengan header api-key dari env var FORTYGUARD_API_KEY (server-only, jangan
  pernah expose ke client), body sesuai format polygon_aoi/date_time/granularity
  di atas -> return activity_id sebagai jobId
- Buat /api/heat/status/[jobId] yang proxy GET /v1/status/{activity_id}
- Di client, pakai React Query dengan refetchInterval backoff (3s/6s/12s)
  untuk poll status sampai selesai
- Simpan hasil grid temperatur ke store
- Cache hasil di Supabase table heat_cache keyed by (aoi_hash, date, hour)
  supaya tidak submit ulang & buang credit untuk AOI yang sama

STEP 6 — 3D rendering (baru mulai setelah step 4 & 5 stabil)
- Ganti map jadi deck.gl 3D: BuildingLayer (GeoJsonLayer extruded, tinggi
  dari tag building:levels, default 1 lantai kalau kosong dan tandai
  attribution "estimated")
- LandcoverLayer: warnai polygon grass hijau, road abu-abu, water biru
- HeatOverlayLayer: render grid FortyGuard sebagai HeatmapLayer/ContourLayer
  di atas AOI, toggle-able
- Tambahkan toggle 2D/3D dan toggle heat overlay di map controls

STEP 7 — Polish
- Loading state yang jelas saat poll FortyGuard (bisa lama)
- Error state kalau Overpass/FortyGuard gagal
- Cache hasil per AOI (Supabase table: aoi_cache) supaya AOI yang sama
  tidak fetch ulang

Kerjakan satu step selesai dan saya cek sebelum lanjut ke step berikutnya.
Jangan install library 3D tambahan di luar deck.gl tanpa saya setujui dulu.
```

---

## 8. Yang dibutuhkan untuk submission (dari handbook, siapkan dari awal)

Ini bukan bagian dari fitur 1 secara teknis, tapi berpengaruh ke cara kamu kerja mulai hari ini:

- Repo **public** (atau minimal invite `hackathon@fortyguard.com` sebagai collaborator) dengan README cara run
- Demo video **maks 3 menit**
- Ringkasan tertulis **maks 500 kata**, formatnya harus: **problem → user → cara pakai FortyGuard → hasil terukur**. Ikuti urutan ini persis karena judging rubric-nya sama: Impact & Relevance 40%, Technical Execution 35%, Innovation 15%, Communication 10%
- Jangan commit API key ke repo (pakai `.env`, git-ignored) — pelanggaran ini eksplisit dilarang di terms
- API key sifatnya privat untuk proyek /b/bhackathon ini saja, tidak boleh dipakai di luar itu

## 9. Yang sengaja TIDAK dikerjakan di fitur ini

- Operational Analyst logic (shift optimizer, what-if simulation) — slot sidebar saja
- AI Copilot / chat — slot sidebar saja
- PDF report
- Upload foto untuk analisis

Semua di atas nunggu fitur 1 stabil dulu, biar scope 2 hari realistis.
