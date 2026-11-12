'use strict';
/**
 * Demo data seeder — generates a realistic Indonesian high-school dataset:
 * teachers, students, employees, two weeks of attendance, requests,
 * announcements, news, an academic calendar and extracurricular schedules.
 */
const db = require('./db');
const U = require('./util');

/* ---------------------------- name pools ---------------------------- */
const TEACHERS = [
  'Drs. Adi Sucipto, M.Pd', 'Dra. Sugiarti, M.Pd', 'Slamet Riyadi, S.Pd',
  'Dra. Wiratini, M.Pd', 'Drs. Mulyadi, M.Pd', 'Siti Aminah, S.Pd',
  'Drs. Joko Susilo, M.Pd', 'Dra. Yuniarti, M.Pd', 'Agus Salim, S.Pd',
  'Dra. Ratna Dewi, M.Pd', 'Drs. Eko Santoso, M.Pd', 'Sri Wahyuni, S.Pd',
  'Drs. Bambang Wijaya, M.Pd', 'Dra. Hastuti, M.Pd', 'Muhammad Fauzi, S.Pd',
  'Dra. Puspita Sari, M.Pd', 'Drs. Hadi Saputro, M.Pd', 'Dra. Lestarini, M.Pd',
  'Andi Prasetya, S.Pd', 'Dra. Windawati, M.Pd', 'Drs. Pujiono, M.Pd',
  'Dra. Yuliani, M.Pd', 'Drs. Sugeng, M.Pd', 'Dra. Kartika Sari, M.Pd',
];
const SUBJECTS = ['Matematika', 'Bahasa Indonesia', 'Bahasa Inggris', 'Fisika', 'Kimia', 'Biologi', 'Sejarah', 'Geografi', 'Pendidikan Kewarganegaraan', 'Seni Budaya', 'Penjaskes', 'Ekonomi', 'Akuntansi', 'Komputer', 'Bahasa Jawa', 'Agama Islam', 'Agama Kristen', 'Matematika', 'IPS', 'IPA'];

const STUDENT_FIRST = [
  'Rafli', 'Nadia', 'Aditya', 'Siti', 'Bima', 'Dewi', 'Gilang', 'Ayu', 'Faisal', 'Citra',
  'Dafa', 'Elika', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko', 'Khilmi', 'Lina', 'Muhammad',
  'Nisa', 'Oktari', 'Pandhu', 'Rina', 'Surya', 'Taufik', 'Umala', 'Viki', 'Wita', 'Zainal',
  'Ainun', 'Bagas', 'Candra', 'Diana', 'Evan', 'Fatimah', 'Gilang', 'Hafiz', 'Intan', 'Juan',
  'Khaila', 'Lukman', 'Meita', 'Naufal', 'Putri', 'Rizky', 'Syifa', 'Teguh', 'Ulfa', 'Vera',
  'Wahyu', 'Yasmin', 'Zendi', 'Agung', 'Berlian', 'Cakra', 'Dini', 'Eka', 'Firda', 'Ghefira',
  'Hanif', 'Ilham', 'Jasmine', 'Koko', 'Laila', 'Mika', 'Noval', 'Olivia', 'Pandu', 'Qori',
];
const STUDENT_LAST = ['Wijaya', 'Lestari', 'Saputra', 'Rahmawati', 'Kurniawan', 'Sari', 'Pratama', 'Ayu', 'Hidayat', 'Cahyani',
  'Maulana', 'Fajri', 'Andini', 'Nurcahyo', 'Puspita', 'Budiman', 'Kurniawati', 'Firmansyah', 'Marta', 'Saputra',
  'Rahma', 'Wicaksana', 'Ningrum', 'Santoso', 'Meita', 'Gunawan', 'Hayati', 'Sudibyo', 'Rahmadani', 'Sidiq',
  'Utomo', 'Permana', 'Sulistiyowati', 'Darmawan', 'Kusumo', 'Atmojo', 'Sulistyaningsih', 'Rahman', 'Kuswandi', 'Mangunsong',
];
// SMP Negeri 1 Yogyakarta — three grade levels (VII, VIII, IX).
const CLASSES = ['VII-A', 'VII-B', 'VII-C', 'VII-D', 'VIII-A', 'VIII-B', 'VIII-C', 'VIII-D', 'IX-A', 'IX-B', 'IX-C'];
/** The digit used in a student's id number for a given class, e.g. VII-A -> 7. */
const CLASS_DIGIT = { VII: '7', VIII: '8', IX: '9' };

const EMPLOYEES = [
  'Dra. Suhartiningsih', 'Drs. Suwarno', 'Siti Rohmah, S.Sos', 'Dra. Sulistiyorini',
  'Muhammad Riza, S.Pd', 'Dra. Tri Astuti', 'Joko Prasetyo, S.Kom', 'Dra. Rina Mariana',
  'Agus Supriyanto', 'Dra. Supriyanti',
];

/**
 * Extracurriculars with the richer shape:
 *   places[]   — the venues an extracurricular rotates through
 *   sessions[] — many schedules, each pointing at one of the places and
 *                optionally limited to a grade group
 */
const EXTRACURRICULARS = [
  {
    name: 'Pasukan Pengibar Bendera (Paskibraka)', category: 'Organisasi', desc: 'Pelatihan kedisiplinan dan upacara bendera.',
    places: [
      { name: 'Lapangan Upacara', note: 'Titik utama baris-berbaris' },
      { name: 'Aula Utama', note: 'Latihan formasi saat hujan' },
    ],
    sessions: [
      { day: 'Senin', start: '06:30', end: '07:30', place: 'Lapangan Upacara', group: '' },
      { day: 'Rabu', start: '06:30', end: '07:30', place: 'Lapangan Upacara', group: 'Kelas VII' },
      { day: 'Jumat', start: '06:30', end: '07:30', place: 'Aula Utama', group: 'Kelas VIII' },
    ],
    groups: ['Kelas VII', 'Kelas VIII'],
  },
  {
    name: 'Pramuka Gugus Depan Wiratama', category: 'Kepanduan', desc: 'Kegiatan kepanduan, tabah dan terampil.',
    places: [
      { name: 'Kampoeng Pramuka', note: 'Area perkemahan belakang sekolah' },
      { name: 'Lapangan Parkir Barat', note: 'Latihan tongkat dan Morse' },
    ],
    sessions: [
      { day: 'Selasa', start: '15:45', end: '17:15', place: 'Kampoeng Pramuka', group: 'Kelas VII' },
      { day: 'Kamis', start: '15:45', end: '17:15', place: 'Kampoeng Pramuka', group: 'Kelas VIII' },
      { day: 'Sabtu', start: '08:00', end: '10:00', place: 'Lapangan Parkir Barat', group: '' },
    ],
    groups: ['Kelas VII', 'Kelas VIII'],
  },
  {
    name: 'Basket Putra & Putri', category: 'Olahraga', desc: 'Latihan fisik, teknik, dan permainan tim.',
    places: [
      { name: 'GOR Koko Dadya', note: 'Lapangan indoor' },
      { name: 'Lapangan Outdoor Timur', note: 'Cadangan saat GOR dirawat' },
    ],
    sessions: [
      { day: 'Senin', start: '16:00', end: '17:30', place: 'GOR Koko Dadya', group: '' },
      { day: 'Rabu', start: '16:00', end: '17:30', place: 'GOR Koko Dadya', group: 'Kelas IX' },
      { day: 'Jumat', start: '15:45', end: '17:15', place: 'Lapangan Outdoor Timur', group: 'Kelas VII' },
    ],
    groups: ['Kelas VII', 'Kelas IX'],
  },
  {
    name: 'Futsal Ekstrakurikuler', category: 'Olahraga', desc: 'Latihan futsal dan internal competition.',
    places: [
      { name: 'Futsal Kompleks SP1TA', note: 'Lapangan sintetis' },
    ],
    sessions: [
      { day: 'Kamis', start: '16:00', end: '17:30', place: 'Futsal Kompleks SP1TA', group: '' },
      { day: 'Sabtu', start: '09:00', end: '10:30', place: 'Futsal Kompleks SP1TA', group: 'Kelas VIII' },
    ],
    groups: ['Kelas VIII'],
  },
  {
    name: 'Robotika & Coding Club', category: 'Teknologi', desc: 'Rancang bangun robot, Arduino, dan pemrograman.',
    places: [
      { name: 'Lab Komputer 2', note: 'Ruang praktik utama' },
      { name: 'Perpustakaan', note: 'Riset dan penyusunan laporan' },
    ],
    sessions: [
      { day: 'Selasa', start: '15:45', end: '17:15', place: 'Lab Komputer 2', group: '' },
      { day: 'Jumat', start: '15:45', end: '17:15', place: 'Lab Komputer 2', group: 'Kelas VIII' },
    ],
    groups: ['Kelas VII', 'Kelas VIII'],
  },
  {
    name: 'Marching Band "Wirama"', category: 'Seni', desc: 'Latihan tata suara dan formation.',
    places: [
      { name: 'Lapangan Parkir Barat', note: 'Latihan formasi' },
      { name: 'Sala Karawitan', note: 'Latihan nada dan ritme' },
    ],
    sessions: [
      { day: 'Rabu', start: '15:30', end: '17:00', place: 'Lapangan Parkir Barat', group: '' },
      { day: 'Sabtu', start: '08:30', end: '10:30', place: 'Sala Karawitan', group: '' },
    ],
    groups: ['Kelas VII', 'Kelas VIII', 'Kelas IX'],
  },
  {
    name: 'PMR (Palang Merah Remaja)', category: 'Kesehatan', desc: 'Pertolongan pertama, donor darah, dan kesehatan masyarakat.',
    places: [
      { name: 'UKS Pusat', note: 'Ruang praktik kesehatan' },
    ],
    sessions: [
      { day: 'Selasa', start: '15:45', end: '17:15', place: 'UKS Pusat', group: '' },
    ],
    groups: ['Kelas VII', 'Kelas VIII'],
  },
  {
    name: 'Karawitan & Budaya Jawa', category: 'Seni', desc: 'Latihan gamelan, gendhing, dan tari.',
    places: [
      { name: 'Sala Karawitan', note: 'Ruang gamelan' },
      { name: 'Aula Utama', note: 'Gladi bersih pentas' },
    ],
    sessions: [
      { day: 'Kamis', start: '15:45', end: '17:15', place: 'Sala Karawitan', group: '' },
      { day: 'Sabtu', start: '13:00', end: '15:00', place: 'Aula Utama', group: 'Kelas IX' },
    ],
    groups: ['Kelas VII', 'Kelas IX'],
  },
];

/** Weekly lesson grid — periods per day, used to build a conflict-free timetable. */
const CLASS_TIMETABLE = [
  { day: 'Senin', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '12:25'], ['12:25', '13:05'], ['13:05', '13:45'], ['13:45', '14:25']] },
  { day: 'Selasa', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '12:25'], ['12:25', '13:05'], ['13:05', '13:45'], ['13:45', '14:25']] },
  { day: 'Rabu', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '12:25'], ['12:25', '13:05'], ['13:05', '13:45'], ['13:45', '14:25']] },
  { day: 'Kamis', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '12:25'], ['12:25', '13:05'], ['13:05', '13:45'], ['13:45', '14:25']] },
  { day: 'Jumat', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '11:25'], ['11:25', '12:05']] },
  { day: 'Sabtu', slots: [['07:30', '08:50'], ['08:50', '10:30'], ['10:45', '12:25']] },
];
const CLASS_ROOMS = ['Ruang X-A', 'Ruang X-B', 'Ruang X-C', 'Ruang XI-A', 'Ruang XI-B', 'Ruang XI-C', 'Ruang XI-D', 'Ruang XII-A', 'Ruang XII-B', 'Ruang XII-C', 'Lab Fisika', 'Lab Kimia', 'Lab Biologi', 'Lab Komputer 1', 'Aula Utama'];

const QUOTES_CHECKIN = [
  'Selamat pagi! Setiap langkah kecil adalah awal dari pencapaian yang besar.',
  'Datang tepat waktu adalah bentuk hormat terhadap waktu dan diri sendiri.',
  'Semangat pagi, hari ini akan menjadi luar biasa.',
  'Kehadiranmu adalah kekuatan kelas ini. Sekali lagi, kamu mampu!',
];
const QUOTES_CHECKOUT = [
  'Sampai jumpa esok. Semoga karyamu hari ini membawa berkah.',
  'Pulang dengan hati penuh syukur. Esok kita bertemu lagi!',
  'Hari yang baik, semoga istirahatmu menyenangkan.',
  'Berhasil melewati hari ini, memberikan yang terbaik untuk esok.',
];

const REQUEST_TYPES = ['Sickness', 'Family Agenda', 'Official Duty', 'Personal', 'Other'];
const REQUEST_TITLES = {
  Sickness: ['Demam berdahak', 'Flu berat', 'Sakit perut', 'Gigi ngilu', 'Sakit kepala', 'Batuk berdahak'],
  'Family Agenda': ['Acara keluarga', 'Kenduri', 'Pernikahan saudara', 'Acara keluarga besar', 'Haflah putra', 'Aqiqah'],
  'Official Duty': ['Seminar pengguna', 'Lokakarya Kurikulum Merdeka', 'Pelatihan pengelola keuangan', 'Sidang akbar', 'Gladi bersih paskibraka'],
  Personal: ['Mengurus dokumen', 'Konseling', 'Melaporkan diri', 'Perjalanan dinas', 'Kegiatan sosial'],
  Other: ['Alasan pribadi', 'Kegiatan organisasi luar', 'Perbaikan kendaraan', 'Tendansi'],
};

const NEWS = [
  { title: 'SMP Negeri 1 Yogyakarta Raih Juara 1 Lomba Karya Ilmiah Remaja Tingkat DIY', details: 'Tim penelitian siswa kelas XII-A dengan judul "Pemanfaatan Limbah Kulit Pisang Sebagai Alternatif Bioplastik" berhasil meraih peringkat pertama dalam LMIK-XXIX tingkat Daerah Istimewa Yogyakarta. Mereka membawa pulang piala dan dana pengembangan sebesar Rp15.000.000 untuk dilanjutkan ke tingkat nasional.' },
  { title: 'Pendaftaran Calon Peserta Didik Baru Diperpanjang hingga 30 November', details: 'Pemerintah Daerah Kota Yogyakarta memperpanjang jalur penerimaan peserta didik baru untuk tahun pelajaran 2026/2027. Calon orang tua dapat mendaftar melalui portal ppdb.sp1yogyakarta.sch.id. Kuota tersisa 62 tempat untuk jenjang VII.' },
  { title: 'Guru SMP Negeri 1 Yogyakarta Mendapat Penghargaan Tingkat Nasional', details: 'Slamet Riyadi, S.Pd., guru Matematika, menerima penghargaan sebagai pendidik inovatif tingkat nasional dari Kemdikbudristek atas inovasi pembelajaran berbasis proyek yang diterapkan selama dua tahun terakhir.' },
  { title: 'Perbaikan Fasilitas GOR Dimulai Senin Depan', details: 'Pengecoran lantai GOR Koko Dadya akan dilakukan mulai Senin (2 Nov) hingga Rabu (4 Nov). Selama perbaikan, kegiatan ekstrakurikuler basket dan futsal pindah ke lapangan luar dan lab komputer.' },
  { title: 'Posko Donasi Bencana Alam Dibuka Seluruh Hari', details: 'SMP Negeri 1 Yogyakarta membuka posko donasi untuk korban banjir di beberapa wilayah Daerah Istimewa Yogyakarta. Barang yang dibutuhkan antara lain air bersih, makanan ringan, selimut, dan pakaian layak pakai.' },
];

const ANNOUNCEMENTS = [
  { title: 'Ujian Akhir Semester Ganjil 2025/2026', location: 'Semua Ruang Kelas', details: 'Diberitahukan kepada seluruh peserta didik bahwa Ujian Akhir Semester Ganjil akan dilaksanakan pada 10—14 November 2025. Jadwal lengkap telah dipajang di ruang guru dan dapat diakses melalui portal sekolah. Harap membawa kartu ujian dan alat tulis yang cukup.' },
  { title: 'Pengumuman: Perbaikan Jaringan Internet Hari Jumat', location: 'Lab Komputer', details: 'Sehubungan dengan maintenance pusat data, akses internet di area sekolah akan terganggu pada hari Jumat, 31 Oktober 2025, pukul 08.00—12.00 WIB. Harap planned kegiatan yang membutuhkan akses online dilakukan di luar waktu tersebut.' },
  { title: 'Latihan Umum Paskibraka bulan November', location: 'Lapangan Upacara', details: 'Regu Paskibraka akan mengadakan latihan umum setiap Senin, Rabu, dan Jumat pukul 06.30 WIB. Kehadiran wajib, terdapat sanksi bagi yang tidak hadir tanpa keterangan resmi.' },
  { title: 'Seminar Career Day dengan Alumni', location: 'Aula Utama', details: 'Acara Career Day akan dilaksanakan pada Sabtu, 8 November 2025, pukul 08.30—12.00 WIB. Sebanyak 12 alumni akan berbagi pengalaman kuliah dan dunia kerja. Dibuka untuk kelas XI dan XII.' },
  { title: 'Pengaturan Kehadiran melalui Absensi Digital', location: 'Seluruh Warga Sekolah', details: 'Mulai Senin depan, seluruh warga sekolah wajib melakukan absen masuk dan pulang menggunakan aplikasi Absensi digital. Kehadiran tanpa absen digital dianggap tidak hadir. Harap memastikan GPS pada ponsel dalam keadaan menyala.' },
  { title: 'Jadwal Pembelajaran Remedial', location: 'Ruang Guru', details: 'Remedial untuk mata pelajaran Matematika dan Bahasa Inggris akan dilaksanakan pada 17—19 November 2025 sesuai jadwal yang telah disetujui oleh koordinator bidang studi.' },
];

const EVENTS = [
  { title: 'Peringatan Hari Sumpah Pemuda', type: 'academic', date: '2025-10-28', desc: 'Upacara bendera penuh dengan membacakan sumpah pemuda.' },
  { title: 'Seminar Career Day', type: 'academic', date: '2025-11-08', desc: 'Sharing session dengan 12 alumni SMP Negeri 1 Yogyakarta.' },
  { title: 'Ujian Akhir Semester Ganjil', type: 'exam', date: '2025-11-10', end: '2025-11-14', desc: 'Pelaksanaan UAS Ganjil untuk seluruh kelas.' },
  { title: 'Cuti Hari Besar', type: 'holiday', date: '2025-11-01', desc: 'Cuti bersama peringatan Maulid Nabi Muhammad SAW.' },
  { title: 'Pendaftaran Calon Peserta Didik Baru', type: 'academic', date: '2025-11-01', end: '2025-11-30', desc: 'Pendaftaran jalur prestasi dan teste online.' },
  { title: 'Apel Pagi Hari Senin', type: 'meeting', date: '2025-11-03', desc: 'Apel gabungan seluruh warga sekolah pukul 07.15 WIB.' },
  { title: 'Workshop Kurikulum Merdeka', type: 'meeting', date: '2025-11-12', desc: 'Workshop penggunaan modul ajar P5 bagi guru.' },
  { title: 'Peringatan Hari Guru', type: 'academic', date: '2025-11-25', desc: 'Upacara dan penyusunan puisi bagi seluruh guru.' },
  { title: 'Festival Budaya Nusantara', type: 'academic', date: '2025-12-05', desc: 'Pameran dan pertunjukan kesenian Nusantara.' },
  { title: 'Cuti Tahun Baru 2026', type: 'holiday', date: '2026-01-01', desc: 'Cuti bersama tahun baru masehi.' },
  { title: 'Penyerahan Raport Semester Genap', type: 'academic', date: '2026-01-18', desc: 'Penyerahan raport dan rapat orang tua per kelas.' },
  { title: 'Penentuan Kelas IX', type: 'academic', date: '2026-01-20', desc: 'Pengumuman penempatan kelas XII berdasarkan ranking.' },
];

/* ---------------------------- geo helpers --------------------------- */
/** Jalan Cik Di Tiro No. 29, Kotabaru, Gondokusuman, Yogyakarta. */
const SCHOOL = { lat: -7.78282, lng: 110.36706 };
// Slightly offset locations so demo data is not all identical.
function near(base, spread, i) {
  const ang = (i * 137.508) % 360;
  const r = spread * (0.35 + ((i * 37) % 100) / 160);
  return {
    lat: U.round(base.lat + (r * Math.cos((ang * Math.PI) / 180)) / 111000, 6),
    lng: U.round(base.lng + (r * Math.sin((ang * Math.PI) / 180)) / (111000 * Math.cos(((base.lat * Math.PI) / 180))), 6),
  };
}

/* ------------------------------ build ------------------------------ */
function build() {
  const store = require('./db');
  const data = store.ensure();
  data.schools = [];
  data.users = [];
  data.attendance = [];
  data.requests = [];
  data.announcements = [];
  data.news = [];
  data.events = [];
  data.extracurriculars = [];
  data.ec_attendance = [];
  data.ec_members = [];
  data.ec_mentors = [];
  data.ec_places = [];
  data.ec_schedules = [];
  data.class_schedules = [];
  data.parent_links = [];
  data.logs = [];

  const school = {
    id: 'school_default',
    name: 'SMP Negeri 1 Yogyakarta',
    code: 'SP1TA',
    address: 'Jalan Cik Di Tiro No.29, Yogyakarta, Daerah Istimewa Yogyakarta, Indonesia',
    phone: '(0274) 560232',
    email: 'info@sp1yogyakarta.sch.id',
    website: 'sp1yogyakarta.sch.id',
    lat: SCHOOL.lat,
    lng: SCHOOL.lng,
    logo: '',
    established: 1946,
    description: 'SMP Negeri 1 Yogyakarta adalah sekolah menengah pertama negeri yang berada di Jalan Cik Di Tiro, Yogyakarta. Sekolah ini mengedepankan kedisiplinan, kreativitas, dan prestasi akademik peserta didiknya.',
  };
  data.schools.push(school);

  const t0 = U.tzMinutes('Asia/Jakarta');
  const today = U.localDateStr(new Date(), t0);
  const yesterday = U.addDays(today, -1);
  // Historical records only — "today" is handled separately below so the
  // live check-in feed stays realistic (not everyone has arrived yet).
  const twoWeeks = U.dateRange(U.addDays(today, -13), U.addDays(today, -1));

  // ---------------- users ----------------
  const users = [];
  const pushUser = (role, name, extra) => {
    const u = Object.assign(
      {
        id: U.uid('usr'),
        school_id: 'school_default',
        role,
        name,
        status: 'active',
        phone: '+62 8' + String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9),
        avatar: '',
        bio: '',
        score_points: 0,
        created_at: new Date().toISOString(),
      },
      extra
    );
    users.push(u);
    data.users.push(u);
    return u;
  };

  TEACHERS.forEach((n, i) => {
    const subj = SUBJECTS[i % SUBJECTS.length];
    const pid = `${school.code}T${String(i + 1).padStart(3, '0')}`;   // SP1TAT001
    pushUser('teacher', n, {
      id_number: pid,
      email: `guru.${String(i + 1).padStart(2, '0')}@sp1yogyakarta.sch.id`,
      position: subj === 'Matematika' ? 'Wakil Kepala Urusan Kurikulum' : subj === 'Bahasa Indonesia' ? 'Ketua Bidang Bahasa' : `Guru ${subj}`,
      subject: subj,
      class_assignment: [...new Set([i, i + 3, i + 7].map((x) => CLASSES[x % CLASSES.length]))].join(', '),
      gender: i % 3 === 0 ? 'L' : 'P',
      birth_date: U.addDays(today, -(38 + i)),
      bio: `Mengajar di SMP Negeri 1 Yogyakarta sejak 2011. Fokus pada pembelajaran berbasis proyek dan pengembangan karakter peserta didik.`,
      score_points: 40 + ((i * 17) % 180),
    });
  });

  const classPlan = CLASSES.map((c, ci) => {
    const size = 16 + ((ci * 3) % 4);
    return { class: c, size, teacher: users.length + ci };
  });
  classPlan.forEach((cp, ci) => {
    for (let s = 0; s < cp.size; s++) {
      const fn = STUDENT_FIRST[(ci * 11 + s) % STUDENT_FIRST.length];
      const ln = STUDENT_LAST[(ci * 7 + s + 3) % STUDENT_LAST.length];
      // VII-A -> SP1TA7A01, VIII-B -> SP1TA8B02, IX-C -> SP1TA9C03
      const cd = CLASS_DIGIT[cp.class.split('-')[0]] || '7';
      const cg = (cp.class.split('-')[1] || 'A').charAt(0);
      const pid = `${school.code}${cd}${cg}${String(s + 1).padStart(2, '0')}`;
      pushUser('student', `${fn} ${ln}`, {
        id_number: pid,
        email: `${pid.toLowerCase()}@student.sp1yogyakarta.sch.id`,
        class_name: cp.class,
        gender: (s + ci) % 2 === 0 ? 'L' : 'P',
        birth_date: U.addDays(today, -(15 + ((ci + s) % 4))),
        bio: '',
        score_points: 10 + ((ci * s * 7) % 120),
        guardian: `Orang Tua ${fn}`,
        guardian_phone: '+62 8' + String(200000000 + ((ci * s + 7) % 799999999)).slice(0, 9),
        home_address: `Jl. Cik Di Tiro No. ${s + 1}, Yogyakarta`,
      });
    }
  });

  EMPLOYEES.forEach((n, i) => {
    pushUser('employee', n, {
      id_number: `${school.code}E${String(i + 1).padStart(3, '0')}`,
      email: `staf.${String(i + 1).padStart(2, '0')}@sp1yogyakarta.sch.id`,
      position: ['Kepala Tata Usaha', 'Staf Administrasi', 'Staf Keuangan', 'Staf Perpustakaan', 'Staf Laboratorium', 'Staf Sarana Prasarana', 'Staf Urusan Kesiswaan', 'Staf Urusan Kurikulum', 'Staf Urusan Umum', 'Staf Kesiswaan'][i % 10],
      gender: i % 3 === 0 ? 'L' : 'P',
      birth_date: U.addDays(today, -(30 + i)),
      bio: `Staf tata usaha di SMP Negeri 1 Yogyakarta.`,
      score_points: 20 + ((i * 23) % 90),
    });
  });

  // demo admin
  pushUser('admin', 'Administrator Sekolah', {
    id_number: `${school.code}ADM`,
    email: 'admin@sp1yogyakarta.sch.id',
    position: 'Kepala Sekolah',
    gender: 'L',
    birth_date: U.addDays(today, -52),
    bio: 'Administrator sistem absensi sekolah.',
    score_points: 500,
  });

  // ---------------- parents ----------------
  // Parents are their own accounts; the link to a child lives in
  // `parent_links`. Two children are attached to one of them so the child
  // switcher in the app has something to switch.
  const parents = [
    { id_number: `${school.code}P001`, name: 'Budi Santoso', gender: 'L', relationship: 'Ayah', children: ['SP1TA7A01'] },
    { id_number: `${school.code}P002`, name: 'Siti Rahayu', gender: 'P', relationship: 'Ibu', children: ['SP1TA7A01', 'SP1TA7A02'] },
    { id_number: `${school.code}P003`, name: 'Agus Priyanto', gender: 'L', relationship: 'Wali', children: ['SP1TA7A03'] },
  ];
  parents.forEach((p, i) => {
    const pu = pushUser('parent', p.name, {
      id_number: p.id_number,
      email: `ortu.${String(i + 1).padStart(2, '0')}@sp1yogyakarta.sch.id`,
      position: p.relationship,
      gender: p.gender,
      birth_date: U.addDays(today, -(35 + i * 3)),
      bio: `${p.relationship} peserta didik di SMP Negeri 1 Yogyakarta.`,
      home_address: `Jl. Cik Di Tiro No. ${i + 1}, Yogyakarta`,
      score_points: 0,
    });
    p.children.forEach((sid) => {
      const child = data.users.find((u) => u.id_number === sid);
      if (!child) return;
      data.parent_links.push({
        id: U.uid('plk'),
        school_id: 'school_default',
        parent_id: pu.id,
        student_id: child.id,
        relationship: p.relationship,
        created_at: new Date().toISOString(),
      });
    });
  });

  /* Give the rest of the first class a guardian too. Without this the parent
     manager only ever holds a handful of rows, and the statistics, the search
     box and the pagination have nothing to work on. */
  /* Each entry pairs a name with the role it can plausibly hold — "Ibu" is
     always a woman, "Ayah" always a man, "Wali" either. */
  const GUARD_NAMES = [
    ['Hartono Wijaya', 'L', 'Ayah'], ['Endang Suprihatin', 'P', 'Ibu'], ['Joko Susilo', 'L', 'Wali'],
    ['Ratna Kusuma', 'P', 'Ibu'], ['Slamet Riyadi', 'L', 'Ayah'], ['Wulan Anggraini', 'P', 'Wali'],
    ['Bambang Sutrisno', 'L', 'Ayah'], ['Maryati Handayani', 'P', 'Ibu'], ['Dwi Cahyono', 'L', 'Wali'],
    ['Lestari Puspita', 'P', 'Ibu'], ['Teguh Prasetyo', 'L', 'Ayah'], ['Nurhayati Sari', 'P', 'Wali'],
    ['Yanto Kurniawan', 'L', 'Ayah'], ['Sri Wahyuni', 'P', 'Ibu'], ['Fajar Nugroho', 'L', 'Wali'],
    ['Indah Permata', 'P', 'Ibu'], ['Rudi Hermawan', 'L', 'Ayah'], ['Yuli Astuti', 'P', 'Wali'],
    ['Anton Wibowo', 'L', 'Ayah'], ['Maya Kartika', 'P', 'Ibu'],
  ];
  const linkedAlready = new Set(data.parent_links.map((l) => l.student_id));
  const firstClass = (data.users.find((u) => u.role === 'student') || {}).class_name || 'VII-A';
  const roster = data.users
    .filter((u) => u.role === 'student' && u.class_name === firstClass)
    .sort((a, b) => String(a.id_number).localeCompare(String(b.id_number), 'id', { numeric: true }))
    .filter((u) => !linkedAlready.has(u.id));

  roster.forEach((child, i) => {
    const [nm, gender, rel] = GUARD_NAMES[i % GUARD_NAMES.length];
    const pu = pushUser('parent', nm, {
      id_number: `${school.code}P${String(4 + i).padStart(3, '0')}`,
      email: `ortu.${String(4 + i).padStart(2, '0')}@sp1yogyakarta.sch.id`,
      position: rel,
      gender,
      birth_date: U.addDays(today, -(38 + (i % 9))),
      bio: `${rel} ${child.name} di SMP Negeri 1 Yogyakarta.`,
      home_address: `Jl. Cik Di Tiro No. ${i + 4}, Yogyakarta`,
      score_points: 0,
    });
    data.parent_links.push({
      id: U.uid('plk'),
      school_id: 'school_default',
      parent_id: pu.id,
      student_id: child.id,
      relationship: rel,
      created_at: new Date().toISOString(),
    });
  });

  // every demo account uses password: demo123
  data.users.forEach((u) => (u.password = U.hashPassword('demo123')));

  // ---------------- attendance ----------------
  const timeAt = (h, m, off) => {
    const d = new Date();
    d.setUTCHours(h, m, 0, 0);
    return new Date(d.getTime() - off * 60000).toISOString();
  };
  const random = (min, max) => min + Math.random() * (max - min);

  data.users.forEach((u, i) => {
    // Build a per-user "character" so the data feels human.
    const base = (i * 31) % 100;
    twoWeeks.forEach((day, di) => {
      // Weekends / holidays: skip roughly for students
      const dow = new Date(day + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6;
      if (weekend && u.role !== 'employee') return;
      if (weekend && u.role === 'employee' && (base % 3 === 0)) return;

      const isHoliday = EVENTS.some((e) => e.type === 'holiday' && day >= e.date && day <= (e.end || e.date));
      if (isHoliday && Math.random() < 0.85) return;

      const r = (base + di * 7 + i) % 100;
      let status = 'present';
      if (r < 3) status = 'absent';
      else if (r < 7) status = 'late';
      else if (r < 9 && u.role !== 'student') status = 'leave';

      if (status === 'absent') {
        // no record created at all for absent people
        return;
      }

      const inOffset = status === 'late' ? 8 + ((i + di) % 25) : -random(0, 12);
      const inH = 7;
      const inM = 30 + (status === 'late' ? inOffset : Math.floor(inOffset));
      const inTime = timeAt(inH, Math.max(0, inM), t0);
      const loc = near(SCHOOL, 130, i + di);
      const rec = {
        id: U.uid('att'),
        school_id: 'school_default',
        user_id: u.id,
        user_name: u.name,
        role: u.role,
        id_number: u.id_number,
        class_name: u.class_name || '',
        subject: u.subject || '',
        date: day,
        check_in_at: inTime,
        check_in_method: i % 3 === 0 ? 'gps' : 'qr',
        check_in_lat: loc.lat,
        check_in_lng: loc.lng,
        check_in_dist: U.round(U.distanceMeters(loc.lat, loc.lng, SCHOOL.lat, SCHOOL.lng), 1),
        status: status,
      };
      const outOffset = status === 'leave' ? 0 : random(35, 90);
      const outH = 15;
      const outM = Math.round(outOffset) % 60;
      rec.check_out_at = status === 'leave' ? '' : timeAt(outH + Math.floor(outOffset / 60), outM, t0);
      rec.check_out_method = rec.check_out_at ? (i % 2 === 0 ? 'gps' : 'qr') : '';
      rec.check_out_lat = loc.lat;
      rec.check_out_lng = loc.lng;
      rec.check_out_dist = U.round(U.distanceMeters(loc.lat, loc.lng, SCHOOL.lat, SCHOOL.lng), 1);
      rec.work_hours = U.round(((new Date(rec.check_out_at) - new Date(rec.check_in_at)) / 3600000), 2);
      rec.note = '';
      rec.created_at = rec.check_in_at;
      data.attendance.push(rec);
    });
  });

  // check-in records for "today" so the dashboard always looks alive —
  // spread across the last few hours regardless of the time of day.
  const livePool = data.users.filter((u) => u.role !== 'admin');
  const liveNow = Date.now();
  const liveOrder = livePool.slice().sort(() => Math.random() - 0.5).slice(0, 72);
  liveOrder.forEach((u, i) => {
    const minutesAgo = Math.floor(random(0, 5 * 60 + 40)) + i * 35;
    const t = new Date(liveNow - minutesAgo * 60000);
    const mins = Math.floor(random(0, 95));
    const loc = near(SCHOOL, 120, i + 4);
    data.attendance.push({
      id: U.uid('att'),
      school_id: 'school_default',
      user_id: u.id,
      user_name: u.name,
      role: u.role,
      id_number: u.id_number,
      class_name: u.class_name || '',
      subject: u.subject || '',
      date: today,
      check_in_at: t.toISOString(),
      check_in_method: i % 2 === 0 ? 'qr' : 'gps',
      check_in_lat: loc.lat,
      check_in_lng: loc.lng,
      check_in_dist: U.round(U.distanceMeters(loc.lat, loc.lng, SCHOOL.lat, SCHOOL.lng), 1),
      status: minutesAgo > 40 ? 'present' : mins > 10 ? 'late' : 'present',
      check_out_at: '',
      check_out_method: '',
      check_out_lat: 0,
      check_out_lng: 0,
      check_out_dist: 0,
      work_hours: 0,
      note: '',
      created_at: t.toISOString(),
    });
  });

  // ---------------- requests ----------------
  data.users.filter((u) => u.role !== 'admin').forEach((u, i) => {
    if ((i * 13) % 5 !== 0) return;
    const type = REQUEST_TYPES[(i * 3 + 1) % REQUEST_TYPES.length];
    const titles = REQUEST_TITLES[type];
    const title = titles[(i * 5 + 2) % titles.length];
    const st = (i * 7) % 10;
    const day = U.addDays(today, -(1 + (i % 14)));
    const status = st < 6 ? 'approved' : st < 8 ? 'pending' : 'rejected';
    const details = {
      Sickness: `Bapak/Ibu guru yang bersangkutan mengalami ${title} dan memerlukan istirahat serta perawatan medis selama ${1 + (i % 3)} hari. Kondisi sudah mengonsumsi obat sesuai saran tenaga medis.`,
      'Family Agenda': `Ada acara keluarga yang tidak dapat ditinggalkan pada tanggal tersebut. ${title} merupakan kegiatan keluarga besar yang telah direncanakan sejak lama.`,
      'Official Duty': `Diundang untuk mengikuti ${title} secara resmi. Surat undangan telah diserahkan ke bagian tata usaha.`,
      Personal: `Ada keperluan pribadi yang mendesak pada tanggal tersebut. ${title}.`,
      Other: `Mohon izin untuk ${title}. Kondisi pribadi yang membutuhkan perhatian.`,
    }[type];
    data.requests.push({
      id: U.uid('req'),
      school_id: 'school_default',
      user_id: u.id,
      user_name: u.name,
      role: u.role,
      id_number: u.id_number,
      type,
      title,
      details,
      from_date: day,
      to_date: U.addDays(day, i % 3 === 0 ? 0 : 1),
      status,
      created_at: timeAt(8, 15 - (i % 14), t0),
      reviewed_by: status === 'pending' ? '' : 'Administrator Sekolah',
      reviewed_at: status === 'pending' ? '' : timeAt(10, (i % 40), t0),
      review_note: status === 'rejected' ? 'Mohon diurus dan dibuatkan surat resmi terlebih dahulu.' : status === 'approved' ? 'Izin disetujui. Selamat beristirahat dan sehat selalu.' : '',
    });
  });
  // a couple of brand new pending requests for "today"
  data.users.slice(5, 9).forEach((u, i) => {
    data.requests.push({
      id: U.uid('req'),
      school_id: 'school_default',
      user_id: u.id,
      user_name: u.name,
      role: u.role,
      id_number: u.id_number,
      type: 'Sickness',
      title: 'Demam berdahak',
      details: 'Mengalami demam dan batuk berdahak sejak kemarin malam. Sudah minum obat dan mengonsumsi vitamin.',
      from_date: today,
      to_date: today,
      status: 'pending',
      created_at: new Date(Date.now() - (i + 1) * 4200000).toISOString(),
      reviewed_by: '',
      reviewed_at: '',
      review_note: '',
    });
  });

  // ---------------- announcements / news / events ----------------
  ANNOUNCEMENTS.forEach((a, i) => {
    data.announcements.push({
      id: U.uid('ann'),
      school_id: 'school_default',
      title: a.title,
      details: a.details,
      location: a.location || '',
      date: U.addDays(today, -(20 - i * 5)),
      time: ['07:15', '09:00', '12:00', '14:30', '16:00'][i % 5],
      audience: i % 2 === 0 ? 'Semua' : i % 3 === 0 ? 'Guru & Karyawan' : 'Peserta Didik',
      is_pinned: i === 0,
      author: TEACHERS[i % TEACHERS.length],
      created_at: timeAt(8, 20 - i, t0),
    });
  });

  NEWS.forEach((n, i) => {
    data.news.push({
      id: U.uid('news'),
      school_id: 'school_default',
      title: n.title,
      details: n.details,
      date: U.addDays(today, -(30 - i * 6)),
      time: '10:00',
      category: ['Prestasi', 'Akademik', 'Penerimaan', 'Karyawan', 'Fasilitas'][i % 5],
      cover: '',
      author: 'Tim Komunikasi Sekolah',
      views: 12 + ((i * 37) % 240),
      created_at: timeAt(10, i, t0),
    });
  });

  EVENTS.forEach((e) => {
    data.events.push({
      id: U.uid('evt'),
      school_id: 'school_default',
      title: e.title,
      type: e.type,
      date: e.date,
      end_date: e.end || e.date,
      description: e.desc,
      location: e.type === 'meeting' ? 'Aula Utama' : e.type === 'exam' ? 'Ruang Ujian' : 'Seluruh Warga Sekolah',
      created_at: timeAt(7, 30, t0),
    });
  });

  // ---------------- extracurriculars ----------------
  const rooms = [
    { lat: -7.80672, lng: 110.32281 },
    { lat: -7.80611, lng: 110.32366 },
    { lat: -7.80695, lng: 110.32344 },
  ];
  const DOW_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  EXTRACURRICULARS.forEach((ec, i) => {
    const teacher = data.users.find((u) => u.role === 'teacher' && u.subject && ['Matematika', 'Bahasa Inggris', 'Fisika', 'Kimia', 'Seni Budaya', 'Penjaskes', 'Komputer', 'Biologi'][i % 8] === u.subject) || data.users.find((u) => u.role === 'teacher');
    const days = [...new Set(ec.sessions.map((s) => s.day))];
    const base = ec.sessions[0];
    const row = {
      id: U.uid('ec'),
      school_id: 'school_default',
      name: ec.name,
      description: ec.desc,
      category: ec.category,
      schedule_days: days,
      start_time: base.start,
      end_time: base.end,
      room: (ec.places[0] || {}).name || '',
      location_lat: rooms[i % rooms.length].lat,
      location_lng: rooms[i % rooms.length].lng,
      capacity: 24 + i * 6,
      teacher_id: teacher.id,
      teacher_name: teacher.name,
      grade_groups: ec.groups,
      active: true,
      created_at: timeAt(8, i, t0),
    };
    data.extracurriculars.push(row);

    // ---- places (an extracurricular has many venues) ----
    const placeIds = {};
    ec.places.forEach((p, pi) => {
      const geo = near({ lat: row.location_lat, lng: row.location_lng }, 70, i * 5 + pi);
      const place = {
        id: U.uid('ecp'),
        school_id: 'school_default',
        extracurricular_id: row.id,
        name: p.name,
        note: p.note || '',
        lat: geo.lat,
        lng: geo.lng,
        radius_m: 60,
        active: true,
        created_at: timeAt(8, i, t0),
      };
      data.ec_places.push(place);
      placeIds[p.name] = place.id;
    });

    // ---- schedules (many, one place each, optionally grade-scoped) ----
    ec.sessions.forEach((s) => {
      const place = data.ec_places.find((p) => p.extracurricular_id === row.id && p.name === s.place);
      data.ec_schedules.push({
        id: U.uid('ecs'),
        school_id: 'school_default',
        extracurricular_id: row.id,
        day: s.day,
        start_time: s.start,
        end_time: s.end,
        grade_group: s.group || '',
        place_id: place ? place.id : '',
        place_name: place ? place.name : s.place,
        place_lat: place ? place.lat : null,
        place_lng: place ? place.lng : null,
        note: '',
        active: true,
        created_at: timeAt(8, i, t0),
      });
    });

    // ---- mentors / coaches (many per extracurricular) ----
    const coachA = data.users.filter((u) => u.role === 'teacher');
    const coachB = data.users.filter((u) => u.role === 'employee');
    const primary = coachA[(i * 3) % coachA.length];
    const assistant = coachA[(i * 3 + 5) % coachA.length];
    const staffCoach = coachB.length ? coachB[i % coachB.length] : null;
    [
      { u: primary, role: 'Pembina', primary: true },
      { u: assistant, role: 'Pelatih', primary: false },
      { u: staffCoach, role: 'Asisten Pelatih', primary: false },
    ].forEach((m, mi) => {
      if (!m.u) return;
      if (mi > 0 && m.u.id === primary.id) return;
      data.ec_mentors.push({
        id: U.uid('ecm'),
        school_id: 'school_default',
        extracurricular_id: row.id,
        user_id: m.u.id,
        user_name: m.u.name,
        user_role: m.u.role,
        id_number: m.u.id_number || '',
        mentor_role: m.role,
        is_primary: !!m.primary,
        active: true,
        created_at: timeAt(8, i, t0),
      });
    });
  });

  // ---- members: every student joins 1–2 extracurriculars, with a grade group ----
  const students = data.users.filter((u) => u.role === 'student');
  students.forEach((u, i) => {
    const cn = String(u.class_name || '').toUpperCase();
    const groupFromClass = cn.startsWith('IX') ? 'Kelas IX'
      : cn.startsWith('VIII') ? 'Kelas VIII'
        : cn.startsWith('VII') ? 'Kelas VII' : '';
    const count = 2 + (i % 2); // 2–3 activities per student
    for (let k = 0; k < count; k++) {
      const ec = data.extracurriculars[(i * 3 + k * 5) % data.extracurriculars.length];
      if (!ec) continue;
      if (data.ec_members.some((m) => m.extracurricular_id === ec.id && m.user_id === u.id)) continue;
      const groups = ec.grade_groups || [];
      const grade_group = groups.includes(groupFromClass) ? groupFromClass : (groups[0] || groupFromClass);
      data.ec_members.push({
        id: U.uid('ecb'),
        school_id: 'school_default',
        extracurricular_id: ec.id,
        user_id: u.id,
        user_name: u.name,
        id_number: u.id_number || '',
        class_name: u.class_name || '',
        grade_group,
        position: '',
        status: 'active',
        joined_at: U.addDays(today, -((i % 60) + 5)),
        created_at: timeAt(9, i % 40, t0),
      });
    }
  });

  // ---- class timetable: admin-assigned teaching schedule per teacher ----
  // Built class-by-class so no class ever has two subjects in the same slot.
  const teacherList = data.users.filter((u) => u.role === 'teacher');
  // Teachers grouped by the subject they are qualified for.
  const teacherPool = {};
  teacherList.forEach((t) => {
    const subj = t.subject || SUBJECTS[0];
    (teacherPool[subj] = teacherPool[subj] || []).push(t);
  });
  // A teacher can only be in one room per period — track occupancy per slot so
  // the generated timetable never double-books anybody.
  const busy = {};
  CLASSES.forEach((cls, ci) => {
    CLASS_TIMETABLE.forEach((dayPlan, di) => {
      dayPlan.slots.forEach((slot, pi) => {
        const key = dayPlan.day + '@' + slot[0];
        busy[key] = busy[key] || new Set();
        const wanted = SUBJECTS[(ci * 7 + di * 3 + pi * 5) % SUBJECTS.length];
        // Prefer the specialist for the wanted subject; otherwise fall back to
        // any teacher who is free in this period (using their own subject).
        let t = (teacherPool[wanted] || []).find((x) => !busy[key].has(x.id));
        let subject = wanted;
        if (!t) {
          for (let k = 1; k <= SUBJECTS.length && !t; k++) {
            const alt = SUBJECTS[((ci * 7 + di * 3 + pi * 5) + k) % SUBJECTS.length];
            t = (teacherPool[alt] || []).find((x) => !busy[key].has(x.id));
            if (t) subject = alt;
          }
        }
        if (!t) return;
        busy[key].add(t.id);
        const room = CLASS_ROOMS[ci % CLASS_ROOMS.length];
        data.class_schedules.push({
          id: U.uid('cls'),
          school_id: 'school_default',
          day: dayPlan.day,
          start_time: slot[0],
          end_time: slot[1],
          class_name: cls,
          subject,
          teacher_id: t.id,
          teacher_name: t.name,
          room,
          note: '',
          active: true,
          created_at: timeAt(6, 30, t0),
        });
      });
    });
  });
  // A few teacher-managed extras (piket / konseling) so the grid has variety.
  teacherList.slice(0, 6).forEach((t, ti) => {
    data.class_schedules.push({
      id: U.uid('cls'),
      school_id: 'school_default',
      day: ['Senin', 'Rabu', 'Jumat'][ti % 3],
      start_time: '14:25',
      end_time: '15:05',
      class_name: CLASSES[(ti * 2) % CLASSES.length],
      subject: 'Bimbingan Konseling',
      teacher_id: t.id,
      teacher_name: t.name,
      room: 'Ruang BK',
      note: 'Sesi konseling terjadwal',
      active: true,
      created_at: timeAt(6, 30, t0),
    });
  });

  // extracurricular attendance for the last 4 sessions
  data.ec_members.forEach((mem, mi) => {
    const u = data.users.find((x) => x.id === mem.user_id);
    if (!u) return;
    const ec = data.extracurriculars.find((x) => x.id === mem.extracurricular_id);
    if (!ec) return;
    const sessions = data.ec_schedules.filter((s) => s.extracurricular_id === ec.id && s.active);
    if (!sessions.length) return;
    for (let s = 0; s < 3; s++) {
      const day = U.addDays(today, -(s * 7 + ((mi + s) % 5) + 1));
      const dowName = DOW_ID[new Date(day + 'T00:00:00Z').getUTCDay()];
      const sess = sessions.find((x) => x.day === dowName) || sessions[(mi + s) % sessions.length];
      if (sess.grade_group && sess.grade_group !== mem.grade_group) continue;
      const present = (mi + s) % 7 !== 0;
      const venue = data.ec_places.find((p) => p.id === sess.place_id) || { lat: ec.location_lat, lng: ec.location_lng };
      const loc = near({ lat: venue.lat, lng: venue.lng }, 55, mi + s);
        data.ec_attendance.push({
          id: U.uid('eca'),
          school_id: 'school_default',
          extracurricular_id: ec.id,
          extracurricular_name: ec.name,
          ec_schedule_id: sess.id,
          place_id: sess.place_id || '',
          place_name: sess.place_name || '',
          user_id: u.id,
          user_name: u.name,
          class_name: u.class_name || '',
          date: day,
          status: present ? 'present' : 'absent',
          gps_lat: loc.lat,
          gps_lng: loc.lng,
          gps_accuracy: U.round(random(4, 22), 1),
          distance_m: U.round(U.distanceMeters(loc.lat, loc.lng, venue.lat, venue.lng), 1),
          has_selfie: present && (mi % 4 !== 0),
          created_at: timeAt(16, 5 + s, t0),
        });
    }
  });

  // ---------------- logs ----------------
  for (let i = 0; i < 40; i++) {
    const a = data.attendance[(i * 13) % data.attendance.length];
    if (!a) continue;
    data.logs.push({
      id: U.uid('log'),
      school_id: 'school_default',
      actor: a.user_name,
      actor_id: a.user_id,
      action: a.check_in_at ? 'CHECK_IN' : 'CHECK_OUT',
      target: a.user_name,
      target_id: a.user_id,
      detail: `${a.check_in_method.toUpperCase()} · ${U.round(a.check_in_dist, 0)} m`,
      at: a.check_in_at,
    });
  }

  store.replaceAll('schools', data.schools);
  store.replaceAll('users', data.users);
  store.replaceAll('attendance', data.attendance);
  store.replaceAll('requests', data.requests);
  store.replaceAll('announcements', data.announcements);
  store.replaceAll('news', data.news);
  store.replaceAll('events', data.events);
  store.replaceAll('extracurriculars', data.extracurriculars);
  store.replaceAll('ec_attendance', data.ec_attendance);
  store.replaceAll('ec_members', data.ec_members);
  store.replaceAll('ec_mentors', data.ec_mentors);
  store.replaceAll('ec_places', data.ec_places);
  store.replaceAll('ec_schedules', data.ec_schedules);
  store.replaceAll('class_schedules', data.class_schedules);
  store.replaceAll('parent_links', data.parent_links);
  store.replaceAll('logs', data.logs);
  store.saveNow();

  return {
    users: data.users.length,
    attendance: data.attendance.length,
    requests: data.requests.length,
    announcements: data.announcements.length,
    news: data.news.length,
    events: data.events.length,
    extracurriculars: data.extracurriculars.length,
    ec_attendance: data.ec_attendance.length,
    ec_members: data.ec_members.length,
    ec_mentors: data.ec_mentors.length,
    ec_places: data.ec_places.length,
    ec_schedules: data.ec_schedules.length,
    class_schedules: data.class_schedules.length,
    parent_links: data.parent_links.length,
    today,
  };
}

module.exports = { build };
