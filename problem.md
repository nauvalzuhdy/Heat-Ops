- barchart tidak sesuai di bar building berwarna kuning padahal dipeta biru, road berwarna kuning dipeta tapi dibar berwarna abu abu, dan other berwarna hijau, yang harusnya hijau untuk tanaman, tumbuhan intinya daerah tumbuhan, dan abu habu harusnya data lainnya. tapi di peta cuma menampilkan kuning untuk road dan biru untuk building tidak memberikan warna untuk tanaman dan lainnya,
- Jadi bagian paling kanan AOI tidak mempunyai data temperatur.Bagian kanan itu tetap menampilkan citra satelit/basemap biasa. Isu ini terjadi karena lingkungan development menggunakan data cached fixture dengan batasan MAX_TILES_PER_AXIS = 200. Sementara itu, area cakupan (AOI) yang besar membutuhkan 265 kolom tile. Akibatnya, sekitar 65 kolom tile terpotong dan tidak ditampilkan. Hal ini merupakan keterbatasan konfigurasi fixture lokal, bukan membatasi ketersediaan data aktual dari FortyGuard.
- bisa ubah hal lain seperti site area, land-cover notes untuk folder operational analyst
- tombol close sidebar taruh di pojok kiri atas seperti open sidebar
- difitur hotspot, tidak menampilkan pemetaan panas di bagian satelit, perbaiki ini nanti
- dibagian shift itu data yang diambil dari map view apakah data yg digenerate hanya 12 jam kedepan? apakah tidak bisa mengambil semuanya + 3, +6, + 12 seluruhnya sehingga data lengkap dan lebih penting lagi ada jam, tanggal nya 
pastiin data yang diambil akurat dan dari api asli
- untuk shift katanya jamnya belum terlalu akurat untuk lokasi disana saat ini, coba perbaiki lagi nanti, ini yg perlu di cek lagi nanti 
WBGT: 🟡 MVP approximation
NIOSH risk: 🟡 screening approximation
Timezone: 🟡 known limitation
Live API: 🟡 belum actual-tested
- Kenapa angka ini secara alami tidak bisa "akurat" tanpa data tambahan

kWh saved per m² per °C cooling itu sebenarnya bergantung ke banyak variabel yang berbeda-beda per bangunan:

Jenis atap/dinding, insulasi, tahun bangunan
Ukuran & efisiensi unit AC/HVAC yang dipasang
Orientasi bangunan, berapa jam kena matahari langsung
Iklim lokal (kelembapan, baseline suhu)
- tombol massing land cover buat lebih rapi


