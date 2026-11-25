-- Aşama 10: ilçe listesi, kargo firmaları, gönderiler ve kapıda ödeme tahsilatı.

-- 973 ilçe; src/modules/account/districts.ts ile aynıdır (test karşılaştırır).
create function private.valid_district(p_city text, p_district text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce('{
    "Adana": ["Aladağ", "Ceyhan", "Çukurova", "Feke", "İmamoğlu", "Karaisalı", "Karataş", "Kozan", "Pozantı", "Saimbeyli", "Sarıçam", "Seyhan", "Tufanbeyli", "Yumurtalık", "Yüreğir"],
    "Adıyaman": ["Besni", "Çelikhan", "Gerger", "Gölbaşı", "Kahta", "Merkez", "Samsat", "Sincik", "Tut"],
    "Afyonkarahisar": ["Başmakçı", "Bayat", "Bolvadin", "Çay", "Çobanlar", "Dazkırı", "Dinar", "Emirdağ", "Evciler", "Hocalar", "İhsaniye", "İscehisar", "Kızılören", "Merkez", "Sandıklı", "Sinanpaşa", "Sultandağı", "Şuhut"],
    "Ağrı": ["Diyadin", "Doğubayazıt", "Eleşkirt", "Hamur", "Merkez", "Patnos", "Taşlıçay", "Tutak"],
    "Aksaray": ["Ağaçören", "Eskil", "Gülağaç", "Güzelyurt", "Merkez", "Ortaköy", "Sarıyahşi", "Sultanhanı"],
    "Amasya": ["Göynücek", "Gümüşhacıköy", "Hamamözü", "Merkez", "Merzifon", "Suluova", "Taşova"],
    "Ankara": ["Akyurt", "Altındağ", "Ayaş", "Bala", "Beypazarı", "Çamlıdere", "Çankaya", "Çubuk", "Elmadağ", "Etimesgut", "Evren", "Gölbaşı", "Güdül", "Haymana", "Kahramankazan", "Kalecik", "Keçiören", "Kızılcahamam", "Mamak", "Nallıhan", "Polatlı", "Pursaklar", "Sincan", "Şereflikoçhisar", "Yenimahalle"],
    "Antalya": ["Akseki", "Aksu", "Alanya", "Demre", "Döşemealtı", "Elmalı", "Finike", "Gazipaşa", "Gündoğmuş", "İbradı", "Kaş", "Kemer", "Kepez", "Konyaaltı", "Korkuteli", "Kumluca", "Manavgat", "Muratpaşa", "Serik"],
    "Ardahan": ["Çıldır", "Damal", "Göle", "Hanak", "Merkez", "Posof"],
    "Artvin": ["Ardanuç", "Arhavi", "Borçka", "Hopa", "Kemalpaşa", "Merkez", "Murgul", "Şavşat", "Yusufeli"],
    "Aydın": ["Bozdoğan", "Buharkent", "Çine", "Didim", "Efeler", "Germencik", "İncirliova", "Karacasu", "Karpuzlu", "Koçarlı", "Köşk", "Kuşadası", "Kuyucak", "Nazilli", "Söke", "Sultanhisar", "Yenipazar"],
    "Balıkesir": ["Altıeylül", "Ayvalık", "Balya", "Bandırma", "Bigadiç", "Burhaniye", "Dursunbey", "Edremit", "Erdek", "Gömeç", "Gönen", "Havran", "İvrindi", "Karesi", "Kepsut", "Manyas", "Marmara", "Savaştepe", "Sındırgı", "Susurluk"],
    "Bartın": ["Amasra", "Kurucaşile", "Merkez", "Ulus"],
    "Batman": ["Beşiri", "Gercüş", "Hasankeyf", "Kozluk", "Merkez", "Sason"],
    "Bayburt": ["Aydıntepe", "Demirözü", "Merkez"],
    "Bilecik": ["Bozüyük", "Gölpazarı", "İnhisar", "Merkez", "Osmaneli", "Pazaryeri", "Söğüt", "Yenipazar"],
    "Bingöl": ["Adaklı", "Genç", "Karlıova", "Kiğı", "Merkez", "Solhan", "Yayladere", "Yedisu"],
    "Bitlis": ["Adilcevaz", "Ahlat", "Güroymak", "Hizan", "Merkez", "Mutki", "Tatvan"],
    "Bolu": ["Dörtdivan", "Gerede", "Göynük", "Kıbrıscık", "Mengen", "Merkez", "Mudurnu", "Seben", "Yeniçağa"],
    "Burdur": ["Ağlasun", "Altınyayla", "Bucak", "Çavdır", "Çeltikçi", "Gölhisar", "Karamanlı", "Kemer", "Merkez", "Tefenni", "Yeşilova"],
    "Bursa": ["Büyükorhan", "Gemlik", "Gürsu", "Harmancık", "İnegöl", "İznik", "Karacabey", "Keles", "Kestel", "Mudanya", "Mustafakemalpaşa", "Nilüfer", "Orhaneli", "Orhangazi", "Osmangazi", "Yenişehir", "Yıldırım"],
    "Çanakkale": ["Ayvacık", "Bayramiç", "Biga", "Bozcaada", "Çan", "Eceabat", "Ezine", "Gelibolu", "Gökçeada", "Lapseki", "Merkez", "Yenice"],
    "Çankırı": ["Atkaracalar", "Bayramören", "Çerkeş", "Eldivan", "Ilgaz", "Kızılırmak", "Korgun", "Kurşunlu", "Merkez", "Orta", "Şabanözü", "Yapraklı"],
    "Çorum": ["Alaca", "Bayat", "Boğazkale", "Dodurga", "İskilip", "Kargı", "Laçin", "Mecitözü", "Merkez", "Oğuzlar", "Ortaköy", "Osmancık", "Sungurlu", "Uğurludağ"],
    "Denizli": ["Acıpayam", "Babadağ", "Baklan", "Bekilli", "Beyağaç", "Bozkurt", "Buldan", "Çal", "Çameli", "Çardak", "Çivril", "Güney", "Honaz", "Kale", "Merkezefendi", "Pamukkale", "Sarayköy", "Serinhisar", "Tavas"],
    "Diyarbakır": ["Bağlar", "Bismil", "Çermik", "Çınar", "Çüngüş", "Dicle", "Eğil", "Ergani", "Hani", "Hazro", "Kayapınar", "Kocaköy", "Kulp", "Lice", "Silvan", "Sur", "Yenişehir"],
    "Düzce": ["Akçakoca", "Cumayeri", "Çilimli", "Gölyaka", "Gümüşova", "Kaynaşlı", "Merkez", "Yığılca"],
    "Edirne": ["Enez", "Havsa", "İpsala", "Keşan", "Lalapaşa", "Meriç", "Merkez", "Süloğlu", "Uzunköprü"],
    "Elazığ": ["Ağın", "Alacakaya", "Arıcak", "Baskil", "Karakoçan", "Keban", "Kovancılar", "Maden", "Merkez", "Palu", "Sivrice"],
    "Erzincan": ["Çayırlı", "İliç", "Kemah", "Kemaliye", "Merkez", "Otlukbeli", "Refahiye", "Tercan", "Üzümlü"],
    "Erzurum": ["Aşkale", "Aziziye", "Çat", "Hınıs", "Horasan", "İspir", "Karaçoban", "Karayazı", "Köprüköy", "Narman", "Oltu", "Olur", "Palandöken", "Pasinler", "Pazaryolu", "Şenkaya", "Tekman", "Tortum", "Uzundere", "Yakutiye"],
    "Eskişehir": ["Alpu", "Beylikova", "Çifteler", "Günyüzü", "Han", "İnönü", "Mahmudiye", "Mihalgazi", "Mihalıççık", "Odunpazarı", "Sarıcakaya", "Seyitgazi", "Sivrihisar", "Tepebaşı"],
    "Gaziantep": ["Araban", "İslahiye", "Karkamış", "Nizip", "Nurdağı", "Oğuzeli", "Şahinbey", "Şehitkamil", "Yavuzeli"],
    "Giresun": ["Alucra", "Bulancak", "Çamoluk", "Çanakçı", "Dereli", "Doğankent", "Espiye", "Eynesil", "Görele", "Güce", "Keşap", "Merkez", "Piraziz", "Şebinkarahisar", "Tirebolu", "Yağlıdere"],
    "Gümüşhane": ["Kelkit", "Köse", "Kürtün", "Merkez", "Şiran", "Torul"],
    "Hakkâri": ["Çukurca", "Derecik", "Merkez", "Şemdinli", "Yüksekova"],
    "Hatay": ["Altınözü", "Antakya", "Arsuz", "Belen", "Defne", "Dörtyol", "Erzin", "Hassa", "İskenderun", "Kırıkhan", "Kumlu", "Payas", "Reyhanlı", "Samandağ", "Yayladağı"],
    "Iğdır": ["Aralık", "Karakoyunlu", "Merkez", "Tuzluca"],
    "Isparta": ["Aksu", "Atabey", "Eğirdir", "Gelendost", "Gönen", "Keçiborlu", "Merkez", "Senirkent", "Sütçüler", "Şarkikaraağaç", "Uluborlu", "Yalvaç", "Yenişarbademli"],
    "İstanbul": ["Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy", "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane", "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu"],
    "İzmir": ["Aliağa", "Balçova", "Bayındır", "Bayraklı", "Bergama", "Beydağ", "Bornova", "Buca", "Çeşme", "Çiğli", "Dikili", "Foça", "Gaziemir", "Güzelbahçe", "Karabağlar", "Karaburun", "Karşıyaka", "Kemalpaşa", "Kınık", "Kiraz", "Konak", "Menderes", "Menemen", "Narlıdere", "Ödemiş", "Seferihisar", "Selçuk", "Tire", "Torbalı", "Urla"],
    "Kahramanmaraş": ["Afşin", "Andırın", "Çağlayancerit", "Dulkadiroğlu", "Ekinözü", "Elbistan", "Göksun", "Nurhak", "Onikişubat", "Pazarcık", "Türkoğlu"],
    "Karabük": ["Eflani", "Eskipazar", "Merkez", "Ovacık", "Safranbolu", "Yenice"],
    "Karaman": ["Ayrancı", "Başyayla", "Ermenek", "Kazımkarabekir", "Merkez", "Sarıveliler"],
    "Kars": ["Akyaka", "Arpaçay", "Digor", "Kağızman", "Merkez", "Sarıkamış", "Selim", "Susuz"],
    "Kastamonu": ["Abana", "Ağlı", "Araç", "Azdavay", "Bozkurt", "Cide", "Çatalzeytin", "Daday", "Devrekani", "Doğanyurt", "Hanönü", "İhsangazi", "İnebolu", "Küre", "Merkez", "Pınarbaşı", "Seydiler", "Şenpazar", "Taşköprü", "Tosya"],
    "Kayseri": ["Akkışla", "Bünyan", "Develi", "Felahiye", "Hacılar", "İncesu", "Kocasinan", "Melikgazi", "Özvatan", "Pınarbaşı", "Sarıoğlan", "Sarız", "Talas", "Tomarza", "Yahyalı", "Yeşilhisar"],
    "Kilis": ["Elbeyli", "Merkez", "Musabeyli", "Polateli"],
    "Kırıkkale": ["Bahşılı", "Balışeyh", "Çelebi", "Delice", "Karakeçili", "Keskin", "Merkez", "Sulakyurt", "Yahşihan"],
    "Kırklareli": ["Babaeski", "Demirköy", "Kofçaz", "Lüleburgaz", "Merkez", "Pehlivanköy", "Pınarhisar", "Vize"],
    "Kırşehir": ["Akçakent", "Akpınar", "Boztepe", "Çiçekdağı", "Kaman", "Merkez", "Mucur"],
    "Kocaeli": ["Başiskele", "Çayırova", "Darıca", "Derince", "Dilovası", "Gebze", "Gölcük", "İzmit", "Kandıra", "Karamürsel", "Kartepe", "Körfez"],
    "Konya": ["Ahırlı", "Akören", "Akşehir", "Altınekin", "Beyşehir", "Bozkır", "Cihanbeyli", "Çeltik", "Çumra", "Derbent", "Derebucak", "Doğanhisar", "Emirgazi", "Ereğli", "Güneysınır", "Hadim", "Halkapınar", "Hüyük", "Ilgın", "Kadınhanı", "Karapınar", "Karatay", "Kulu", "Meram", "Sarayönü", "Selçuklu", "Seydişehir", "Taşkent", "Tuzlukçu", "Yalıhüyük", "Yunak"],
    "Kütahya": ["Altıntaş", "Aslanapa", "Çavdarhisar", "Domaniç", "Dumlupınar", "Emet", "Gediz", "Hisarcık", "Merkez", "Pazarlar", "Simav", "Şaphane", "Tavşanlı"],
    "Malatya": ["Akçadağ", "Arapgir", "Arguvan", "Battalgazi", "Darende", "Doğanşehir", "Doğanyol", "Hekimhan", "Kale", "Kuluncak", "Pütürge", "Yazıhan", "Yeşilyurt"],
    "Manisa": ["Ahmetli", "Akhisar", "Alaşehir", "Demirci", "Gölmarmara", "Gördes", "Kırkağaç", "Köprübaşı", "Kula", "Salihli", "Sarıgöl", "Saruhanlı", "Selendi", "Soma", "Şehzadeler", "Turgutlu", "Yunusemre"],
    "Mardin": ["Artuklu", "Dargeçit", "Derik", "Kızıltepe", "Mazıdağı", "Midyat", "Nusaybin", "Ömerli", "Savur", "Yeşilli"],
    "Mersin": ["Akdeniz", "Anamur", "Aydıncık", "Bozyazı", "Çamlıyayla", "Erdemli", "Gülnar", "Mezitli", "Mut", "Silifke", "Tarsus", "Toroslar", "Yenişehir"],
    "Muğla": ["Bodrum", "Dalaman", "Datça", "Fethiye", "Kavaklıdere", "Köyceğiz", "Marmaris", "Menteşe", "Milas", "Ortaca", "Seydikemer", "Ula", "Yatağan"],
    "Muş": ["Bulanık", "Hasköy", "Korkut", "Malazgirt", "Merkez", "Varto"],
    "Nevşehir": ["Acıgöl", "Avanos", "Derinkuyu", "Gülşehir", "Hacıbektaş", "Kozaklı", "Merkez", "Ürgüp"],
    "Niğde": ["Altunhisar", "Bor", "Çamardı", "Çiftlik", "Merkez", "Ulukışla"],
    "Ordu": ["Akkuş", "Altınordu", "Aybastı", "Çamaş", "Çatalpınar", "Çaybaşı", "Fatsa", "Gölköy", "Gülyalı", "Gürgentepe", "İkizce", "Kabadüz", "Kabataş", "Korgan", "Kumru", "Mesudiye", "Perşembe", "Ulubey", "Ünye"],
    "Osmaniye": ["Bahçe", "Düziçi", "Hasanbeyli", "Kadirli", "Merkez", "Sumbas", "Toprakkale"],
    "Rize": ["Ardeşen", "Çamlıhemşin", "Çayeli", "Derepazarı", "Fındıklı", "Güneysu", "Hemşin", "İkizdere", "İyidere", "Kalkandere", "Merkez", "Pazar"],
    "Sakarya": ["Adapazarı", "Akyazı", "Arifiye", "Erenler", "Ferizli", "Geyve", "Hendek", "Karapürçek", "Karasu", "Kaynarca", "Kocaali", "Pamukova", "Sapanca", "Serdivan", "Söğütlü", "Taraklı"],
    "Samsun": ["19 Mayıs", "Alaçam", "Asarcık", "Atakum", "Ayvacık", "Bafra", "Canik", "Çarşamba", "Havza", "İlkadım", "Kavak", "Ladik", "Salıpazarı", "Tekkeköy", "Terme", "Vezirköprü", "Yakakent"],
    "Siirt": ["Baykan", "Eruh", "Kurtalan", "Merkez", "Pervari", "Şirvan", "Tillo"],
    "Sinop": ["Ayancık", "Boyabat", "Dikmen", "Durağan", "Erfelek", "Gerze", "Merkez", "Saraydüzü", "Türkeli"],
    "Sivas": ["Akıncılar", "Altınyayla", "Divriği", "Doğanşar", "Gemerek", "Gölova", "Gürün", "Hafik", "İmranlı", "Kangal", "Koyulhisar", "Merkez", "Suşehri", "Şarkışla", "Ulaş", "Yıldızeli", "Zara"],
    "Şanlıurfa": ["Akçakale", "Birecik", "Bozova", "Ceylanpınar", "Eyyübiye", "Halfeti", "Haliliye", "Harran", "Hilvan", "Karaköprü", "Siverek", "Suruç", "Viranşehir"],
    "Şırnak": ["Beytüşşebap", "Cizre", "Güçlükonak", "İdil", "Merkez", "Silopi", "Uludere"],
    "Tekirdağ": ["Çerkezköy", "Çorlu", "Ergene", "Hayrabolu", "Kapaklı", "Malkara", "Marmaraereğlisi", "Muratlı", "Saray", "Süleymanpaşa", "Şarköy"],
    "Tokat": ["Almus", "Artova", "Başçiftlik", "Erbaa", "Merkez", "Niksar", "Pazar", "Reşadiye", "Sulusaray", "Turhal", "Yeşilyurt", "Zile"],
    "Trabzon": ["Akçaabat", "Araklı", "Arsin", "Beşikdüzü", "Çarşıbaşı", "Çaykara", "Dernekpazarı", "Düzköy", "Hayrat", "Köprübaşı", "Maçka", "Of", "Ortahisar", "Sürmene", "Şalpazarı", "Tonya", "Vakfıkebir", "Yomra"],
    "Tunceli": ["Çemişgezek", "Hozat", "Mazgirt", "Merkez", "Nazımiye", "Ovacık", "Pertek", "Pülümür"],
    "Uşak": ["Banaz", "Eşme", "Karahallı", "Merkez", "Sivaslı", "Ulubey"],
    "Van": ["Bahçesaray", "Başkale", "Çaldıran", "Çatak", "Edremit", "Erciş", "Gevaş", "Gürpınar", "İpekyolu", "Muradiye", "Özalp", "Saray", "Tuşba"],
    "Yalova": ["Altınova", "Armutlu", "Çınarcık", "Çiftlikköy", "Merkez", "Termal"],
    "Yozgat": ["Akdağmadeni", "Aydıncık", "Boğazlıyan", "Çandır", "Çayıralan", "Çekerek", "Kadışehri", "Merkez", "Saraykent", "Sarıkaya", "Sorgun", "Şefaatli", "Yenifakılı", "Yerköy"],
    "Zonguldak": ["Alaplı", "Çaycuma", "Devrek", "Ereğli", "Gökçebey", "Kilimli", "Kozlu", "Merkez"]
  }'::jsonb -> p_city ? p_district, false)
$$;
revoke all on function private.valid_district(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60 and name = btrim(name)),
  -- {no} yerine takip numarası gelir; alan adında kullanılamaz.
  url_template text check (char_length(url_template) <= 300
    and url_template ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+/[^[:space:]<>"''\{}]*\{no\}[^[:space:]<>"''\{}]*$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index carriers_name_key on public.carriers (lower(name));
create trigger carriers_touch before update on public.carriers
for each row execute function private.touch_updated_at();
create trigger carriers_audit after insert or update on public.carriers
for each row execute function private.audit_row();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider text not null default 'manual' check (provider in ('manual')),
  -- Bizim numaramız; firmaya da bununla sorulur.
  our_ref text not null unique,
  provider_ref text,
  carrier_id uuid references public.carriers (id) on delete restrict,
  tracking_no text check (tracking_no ~ '^[A-Z0-9-]{5,40}$'),
  status text not null default 'created' check (status in ('created', 'handed_over', 'delivered', 'returned', 'cancelled')),
  handed_over_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('created', 'cancelled') or (carrier_id is not null and tracking_no is not null and handed_over_at is not null)),
  check ((status in ('delivered', 'returned', 'cancelled')) = (closed_at is not null))
);
-- Çift gönderi engeli: sipariş başına iptal edilmemiş tek gönderi.
create unique index shipments_one_per_order on public.shipments (order_id) where status <> 'cancelled';
create index on public.shipments (order_id);
create index on public.shipments (carrier_id);
-- Aynı takip numarası iki siparişe yazılamaz.
create unique index shipments_tracking_key on public.shipments (carrier_id, tracking_no) where status <> 'cancelled';
create trigger shipments_touch before update on public.shipments
for each row execute function private.touch_updated_at();

create table public.shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  primary key (shipment_id, order_item_id)
);
create index on public.shipment_items (order_item_id);

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  field text not null check (field in ('status', 'carrier', 'tracking_no')),
  from_value text,
  to_value text,
  actor_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index on public.shipment_events (shipment_id, seq);
create index on public.shipment_events (actor_id);
create trigger shipment_events_append_only before update or delete on public.shipment_events
for each row execute function private.forbid_change();
create trigger shipment_events_no_truncate before truncate on public.shipment_events
for each statement execute function private.forbid_change();

-- Kapıda ödemede firmadan beklenen para. Teslim, tahsilat sayılmaz.
create table public.cod_settlements (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null unique references public.shipments (id) on delete restrict,
  expected bigint not null check (expected > 0),
  status text not null default 'pending' check (status in ('pending', 'short', 'settled', 'over')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.cod_settlements (created_at) where status <> 'settled';
create trigger cod_settlements_touch before update on public.cod_settlements
for each row execute function private.touch_updated_at();

-- Firmanın yatırdığı para; yalnızca ekleme. Yanlış kayıt eksi tutarla düzeltilir.
create table public.cod_receipts (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  settlement_id uuid not null references public.cod_settlements (id) on delete restrict,
  amount bigint not null check (amount <> 0 and abs(amount) <= 1000000000),
  reference text not null check (char_length(reference) between 1 and 100 and reference = btrim(reference)),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);
create index on public.cod_receipts (settlement_id, seq);
create index on public.cod_receipts (recorded_by);
create trigger cod_receipts_append_only before update or delete on public.cod_receipts
for each row execute function private.forbid_change();
create trigger cod_receipts_no_truncate before truncate on public.cod_receipts
for each statement execute function private.forbid_change();

alter table public.carriers enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_events enable row level security;
alter table public.cod_settlements enable row level security;
alter table public.cod_receipts enable row level security;
-- Kimse doğrudan yazamaz. Firma listesini kargo izni olan okur; gerisi order_detail ve get_order ile görülür.
revoke all on public.carriers, public.shipments, public.shipment_items, public.shipment_events,
  public.cod_settlements, public.cod_receipts from public, anon, authenticated, service_role;
revoke all on sequence public.shipment_events_seq_seq, public.cod_receipts_seq_seq
from public, anon, authenticated, service_role;
grant select on public.carriers to authenticated;
create policy "personel firma okur" on public.carriers for select to authenticated
using ((select private.has_permission('shipping.read')));

-- ---------------------------------------------------------------------------
-- Fonksiyonlar
-- ---------------------------------------------------------------------------

create function public.save_carrier(p_id uuid, p_name text, p_url text, p_active boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_permission('settings.basic');
  if p_active is null then
    raise exception 'Geçersiz istek.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.carriers (name, url_template, is_active)
    values (btrim(p_name), nullif(btrim(p_url), ''), p_active) returning id into v_id;
  else
    update public.carriers set name = btrim(p_name), url_template = nullif(btrim(p_url), ''), is_active = p_active
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Kargo firması bulunamadı.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Gönderiyi siparişiyle birlikte, her zaman önce siparişi kilitleyerek okur.
create function private.lock_shipment(p_shipment uuid)
returns public.shipments
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
begin
  select * into s from public.shipments where id = p_shipment;
  if not found then
    raise exception 'Gönderi bulunamadı.' using errcode = 'P0002';
  end if;
  perform private.lock_order(s.order_id);
  select * into s from public.shipments where id = p_shipment for update;
  return s;
end;
$$;

create function private.record_shipment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shipment_events (shipment_id, field, to_value, actor_id)
    values (new.id, 'status', new.status, (select auth.uid()));
    return null;
  end if;
  if new.carrier_id is distinct from old.carrier_id then
    insert into public.shipment_events (shipment_id, field, from_value, to_value, actor_id)
    values (new.id, 'carrier', (select name from public.carriers where id = old.carrier_id),
      (select name from public.carriers where id = new.carrier_id), (select auth.uid()));
  end if;
  if new.tracking_no is distinct from old.tracking_no then
    insert into public.shipment_events (shipment_id, field, from_value, to_value, actor_id)
    values (new.id, 'tracking_no', old.tracking_no, new.tracking_no, (select auth.uid()));
  end if;
  if new.status <> old.status then
    insert into public.shipment_events (shipment_id, field, from_value, to_value, actor_id)
    values (new.id, 'status', old.status, new.status, (select auth.uid()));
  end if;
  return null;
end;
$$;
create trigger shipments_history after insert or update on public.shipments
for each row execute function private.record_shipment();

-- Açık gönderi varsa o döner: çift tıklama ikinci gönderi üretmez.
create function public.create_shipment(p_order uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_id uuid;
begin
  perform private.require_permission('shipping.write');
  o := private.lock_order(p_order);
  if o.delivery_method <> 'shipping' or o.order_status <> 'preparing' then
    raise exception 'Bu sipariş için gönderi oluşturulamaz.' using errcode = '22023';
  end if;
  select id into v_id from public.shipments where order_id = o.id and status <> 'cancelled';
  if found then return v_id; end if;

  insert into public.shipments (order_id, our_ref)
  values (o.id, o.order_no || '-' || (select count(*) + 1 from public.shipments where order_id = o.id))
  returning id into v_id;
  insert into public.shipment_items (shipment_id, order_item_id, quantity)
  select v_id, i.id, i.quantity from public.order_items i where i.order_id = o.id;
  update public.orders set shipment_status = 'created' where id = o.id;
  return v_id;
end;
$$;

-- Firma ve takip numarası; kargodayken de düzeltilebilir, eski değer geçmişte kalır.
create function public.update_shipment(p_shipment uuid, p_carrier uuid, p_tracking text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_no text := upper(regexp_replace(p_tracking, '[[:space:]]', '', 'g') collate "C");
begin
  perform private.require_permission('shipping.write');
  s := private.lock_shipment(p_shipment);
  if s.status not in ('created', 'handed_over') then
    raise exception 'Kapanan gönderi değiştirilemez.' using errcode = '22023';
  end if;
  if v_no is null or v_no !~ '^[A-Z0-9-]{5,40}$' then
    raise exception 'Takip numarası 5-40 harf veya rakam olmalı.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.carriers c where c.id = p_carrier
    and (c.is_active or c.id = s.carrier_id)) then
    raise exception 'Kargo firmasını seçin.' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments x where x.carrier_id = p_carrier and x.tracking_no = v_no
    and x.id <> s.id and x.status <> 'cancelled') then
    raise exception 'Bu takip numarası başka bir gönderide kayıtlı.' using errcode = '22023';
  end if;
  update public.shipments set carrier_id = p_carrier, tracking_no = v_no
  where id = s.id and (carrier_id, tracking_no) is distinct from (p_carrier, v_no);
end;
$$;

-- created → handed_over | cancelled; handed_over → delivered | returned. Sipariş aynı işlemde ilerler.
create function public.advance_shipment(p_shipment uuid, p_to text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  o public.orders;
begin
  perform private.require_permission('shipping.write');
  if p_to is null or p_to not in ('handed_over', 'delivered', 'returned', 'cancelled') then
    raise exception 'Geçersiz durum.' using errcode = '22023';
  end if;
  s := private.lock_shipment(p_shipment);
  if s.status = p_to then return; end if;
  if s.status <> (case when p_to in ('handed_over', 'cancelled') then 'created' else 'handed_over' end) then
    raise exception 'Gönderi bu duruma geçemez.' using errcode = '22023';
  end if;
  if p_to = 'handed_over' and (s.carrier_id is null or s.tracking_no is null) then
    raise exception 'Önce kargo firmasını ve takip numarasını yazın.' using errcode = '22023';
  end if;
  perform private.set_note(null);
  update public.shipments set status = p_to,
    handed_over_at = case when p_to = 'handed_over' then now() else handed_over_at end,
    closed_at = case when p_to <> 'handed_over' then now() end
  where id = s.id;
  update public.orders set
    shipment_status = case when p_to = 'cancelled' then 'none' else p_to end,
    order_status = case p_to when 'handed_over' then 'shipped' when 'delivered' then 'delivered'
      when 'returned' then 'returned_to_sender' else order_status end
  where id = s.order_id returning * into o;

  if o.payment_method = 'cod' and p_to = 'delivered' then
    insert into public.cod_settlements (shipment_id, expected) values (s.id, o.total);
  elsif o.payment_method = 'cod' and p_to = 'returned' then
    update public.payments set status = 'cancelled' where order_id = o.id and status = 'pending';
    update public.orders set payment_status = 'cancelled' where id = o.id;
  end if;
end;
$$;

-- Kargo firmasının yatırdığı para. Tam veya fazlaysa tahsil edilmiş sayılır; eksik ve fazla uyarıda kalır.
create function public.record_cod(p_settlement uuid, p_amount bigint, p_reference text, p_key uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  c public.cod_settlements;
  r public.cod_receipts;
  v_order uuid;
  v_sum bigint;
begin
  perform private.require_permission('cod.reconcile');
  if p_key is null or p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000
     or p_reference is null or char_length(btrim(p_reference)) not between 1 and 100 then
    raise exception 'Tutarı ve açıklamayı yazın.' using errcode = '22023';
  end if;
  select s.order_id into v_order from public.cod_settlements x
  join public.shipments s on s.id = x.shipment_id where x.id = p_settlement;
  if not found then
    raise exception 'Tahsilat kaydı bulunamadı.' using errcode = 'P0002';
  end if;
  perform private.lock_order(v_order);
  select * into c from public.cod_settlements where id = p_settlement for update;
  select * into r from public.cod_receipts where idempotency_key = p_key;
  if found then
    if r.settlement_id <> c.id or r.amount <> p_amount then
      raise exception 'Bu istek daha önce kullanılmış.' using errcode = '22023';
    end if;
    return c.status;
  end if;

  insert into public.cod_receipts (settlement_id, amount, reference, recorded_by, idempotency_key)
  values (c.id, p_amount, btrim(p_reference), (select auth.uid()), p_key);
  select sum(amount) into v_sum from public.cod_receipts where settlement_id = c.id;
  if v_sum < 0 then
    raise exception 'Düzeltme, kayıtlı tutarı aşamaz.' using errcode = '22023';
  end if;
  update public.cod_settlements set status = case when v_sum = 0 then 'pending' when v_sum < expected then 'short'
    when v_sum = expected then 'settled' else 'over' end
  where id = c.id returning * into c;

  perform private.set_note(btrim(p_reference));
  update public.payments set status = case when v_sum >= c.expected then 'paid' else 'pending' end,
    paid_at = case when v_sum >= c.expected then coalesce(paid_at, now()) end
  where order_id = v_order;
  update public.orders set payment_status = case when v_sum >= c.expected then 'cod_collected' else 'cod_due' end
  where id = v_order;
  return c.status;
end;
$$;

-- Takip bağlantısı; kalıp yoksa null.
create function private.tracking_url(p_template text, p_no text)
returns text
language sql immutable set search_path = ''
as $$ select replace(p_template, '{no}', p_no) $$;

revoke all on function private.lock_shipment(uuid), private.record_shipment(), private.tracking_url(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.save_carrier(uuid, text, text, boolean), public.create_shipment(uuid),
  public.update_shipment(uuid, uuid, text), public.advance_shipment(uuid, text),
  public.record_cod(uuid, bigint, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.save_carrier(uuid, text, text, boolean), public.create_shipment(uuid),
  public.update_shipment(uuid, uuid, text), public.advance_shipment(uuid, text),
  public.record_cod(uuid, bigint, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Önceki fonksiyonlarda kargo için değişen satırlar
-- ---------------------------------------------------------------------------

create function private.cod_open(p_order uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.cod_settlements x join public.shipments s on s.id = x.shipment_id
    where s.order_id = p_order and x.status <> 'settled')
$$;
revoke all on function private.cod_open(uuid) from public, anon, authenticated, service_role;

-- İlçe listeden olmalı.
create or replace function private.write_order_address(p_order uuid, p_kind text, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.valid_district(p ->> 'city', btrim(p ->> 'district')) then
    raise exception 'Adres geçersiz.' using errcode = '22023';
  end if;
  insert into public.order_addresses (order_id, kind, recipient, phone, city, district, line,
    postal_code, company, tax_office, tax_no)
  values (p_order, p_kind, btrim(p ->> 'recipient'), p ->> 'phone', p ->> 'city',
    btrim(p ->> 'district'), btrim(p ->> 'line'), nullif(p ->> 'postal_code', ''),
    case when p_kind = 'invoice' then nullif(btrim(p ->> 'company'), '') end,
    case when p_kind = 'invoice' then nullif(btrim(p ->> 'tax_office'), '') end,
    case when p_kind = 'invoice' then nullif(p ->> 'tax_no', '') end);
end;
$function$;

-- İlçe listeden olmalı.
create or replace function public.save_address(p_id uuid, p_title text, p_recipient text, p_phone text, p_city text, p_district text, p_line text, p_postal_code text, p_default boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := private.lock_me();
  v_count integer;
  v_default boolean;
  v_id uuid;
begin
  if not private.valid_district(p_city, btrim(p_district)) then
    raise exception 'İl ve ilçe listeden seçilmeli.' using errcode = '23514';
  end if;
  if p_id is null then
    select count(*) into v_count from public.addresses where user_id = v_user;
    if v_count >= 10 then
      raise exception 'En fazla 10 adres kaydedebilirsiniz.' using errcode = '22023';
    end if;
    v_default := v_count = 0 or p_default is true;
  else
    select is_default or p_default is true into v_default from public.addresses
    where id = p_id and user_id = v_user;
    if not found then
      raise exception 'Adres bulunamadı.' using errcode = 'P0002';
    end if;
  end if;

  if v_default then
    update public.addresses set is_default = false
    where user_id = v_user and is_default and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.addresses (
      user_id, title, recipient, phone, city, district, line, postal_code, is_default)
    values (v_user, btrim(p_title), btrim(p_recipient), p_phone, p_city, btrim(p_district),
      btrim(p_line), p_postal_code, v_default)
    returning id into v_id;
  else
    update public.addresses set title = btrim(p_title), recipient = btrim(p_recipient),
      phone = p_phone, city = p_city, district = btrim(p_district), line = btrim(p_line),
      postal_code = p_postal_code, is_default = v_default
    where id = p_id and user_id = v_user
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;

-- Kargolu sipariş yalnızca gönderisiyle birlikte ilerler.
create or replace function private.guard_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (new.id, new.order_no, new.user_id, new.email, new.phone, new.contact_name, new.delivery_method,
      new.payment_method, new.subtotal, new.shipping_fee, new.gift_fee, new.cod_fee, new.discount,
      new.total, new.gift_wrap, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.order_no, old.user_id, old.email, old.phone, old.contact_name, old.delivery_method,
      old.payment_method, old.subtotal, old.shipping_fee, old.gift_fee, old.cod_fee, old.discount,
      old.total, old.gift_wrap, old.idempotency_key, old.created_at) then
    raise exception 'Siparişin içeriği değiştirilemez.' using errcode = '42501';
  end if;
  if new.order_status <> old.order_status then
    -- Süresi dolan siparişin parası sonradan gelir ve stok yeterse sipariş sürer.
    if not private.order_step_allowed(old.order_status, new.order_status, new.delivery_method)
       and not (old.order_status = 'cancelled' and old.cancel_code = 'expired'
         and new.order_status = 'awaiting_approval' and new.payment_status = 'paid') then
      raise exception 'Sipariş bu duruma geçemez.' using errcode = '22023';
    end if;
    if new.order_status = 'awaiting_approval' and new.payment_status <> 'paid' then
      raise exception 'Ödeme doğrulanmadan onaya geçilemez.' using errcode = '22023';
    end if;
    if new.delivery_method = 'shipping' and new.shipment_status is distinct from (case new.order_status
         when 'shipped' then 'handed_over' when 'delivered' then 'delivered'
         when 'returned_to_sender' then 'returned' else new.shipment_status end) then
      raise exception 'Önce gönderiyi işleyin.' using errcode = '22023';
    end if;
    if new.order_status = 'delivered' and new.delivery_method = 'pickup'
       and new.payment_status <> 'paid' then
      raise exception 'Tahsilat yazılmadan teslim edilemez.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

-- Yola çıkmamış gönderi siparişle birlikte iptal olur.
create or replace function private.cancel_locked(p_order orders, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.close_reservations(p_order.id, false);
  perform private.restock_order(p_order.id);
  update public.shipments set status = 'cancelled', closed_at = now()
  where order_id = p_order.id and status = 'created';
  update public.payments set status = 'cancelled' where order_id = p_order.id and status = 'pending';
  update public.orders set order_status = 'cancelled', shipment_status = 'none', cancel_code = p_code,
    payment_status = case
      -- Bankada görülen para (eksik, fazla veya henüz onaysız) iade bekler.
      when payment_status = 'paid' or exists (
        select 1 from public.bank_transfers t join public.payments y on y.id = t.payment_id
        where y.order_id = p_order.id) or exists (
        select 1 from public.payment_attempts a join public.payments y on y.id = a.payment_id
        where y.order_id = p_order.id and a.status in ('paid', 'review', 'refund_due')) then 'refund_pending'
      else 'cancelled' end
  where id = p_order.id;
end;
$function$;

-- Müşteri kargo bilgisini görür.
create or replace function public.get_order(p_no text, p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'order_no', o.order_no, 'created_at', o.created_at, 'delivery_method', o.delivery_method,
    'payment_method', o.payment_method, 'order_status', o.order_status,
    'payment_status', o.payment_status, 'subtotal', o.subtotal, 'shipping_fee', o.shipping_fee,
    'gift_fee', o.gift_fee, 'cod_fee', o.cod_fee, 'total', o.total, 'gift_wrap', o.gift_wrap,
    'payment_due_at', o.payment_due_at,
    'can_cancel', o.order_status in ('pending_payment', 'awaiting_approval'),
    'can_pay', o.payment_method = 'card' and o.order_status = 'pending_payment'
      and o.payment_status in ('pending', 'failed') and o.payment_due_at > now() and private.card_open(),
    'bank', case when o.payment_method = 'transfer' and o.order_status = 'pending_payment' then
      jsonb_build_object('holder', private.setting('bank_holder') #>> '{}', 'iban', private.setting('bank_iban') #>> '{}') end,
    'pickup', case when o.delivery_method = 'pickup' then
      jsonb_build_object('address', private.setting('pickup_address') #>> '{}',
        'until', o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer)) end,
    'address', (select jsonb_build_object('recipient', a.recipient, 'phone', a.phone, 'city', a.city,
        'district', a.district, 'line', a.line, 'postal_code', a.postal_code)
      from public.order_addresses a where a.order_id = o.id and a.kind = 'delivery'),
    'shipment', (select jsonb_build_object('status', s.status, 'carrier', c.name, 'tracking_no', s.tracking_no,
        'url', private.tracking_url(c.url_template, s.tracking_no), 'handed_over_at', s.handed_over_at,
        'closed_at', s.closed_at)
      from public.shipments s join public.carriers c on c.id = s.carrier_id
      where s.order_id = o.id and s.status in ('handed_over', 'delivered', 'returned')),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'color', i.color, 'size', i.size,
        'unit_price', i.unit_price, 'quantity', i.quantity) order by i.name, i.sku)
      from public.order_items i where i.order_id = o.id))
  from public.orders o where o.id = private.find_order(p_no, p_token)
$function$;

-- Panel ayrıntısı: gönderi, geçmişi ve kapıda ödeme tahsilatı.
create or replace function public.order_detail(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.orders;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'created_at', o.created_at, 'is_member', o.user_id is not null,
    'contact_name', o.contact_name, 'email', o.email, 'phone', o.phone,
    'delivery_method', o.delivery_method, 'payment_method', o.payment_method,
    'order_status', o.order_status, 'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'shipping_fee', o.shipping_fee, 'gift_fee', o.gift_fee,
    'cod_fee', o.cod_fee, 'total', o.total, 'gift_wrap', o.gift_wrap,
    'phone_verified', o.phone_verified_at is not null, 'payment_due_at', o.payment_due_at,
    'cancel_code', o.cancel_code,
    'pickup_until', o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer),
    'flags', to_jsonb(case when o.order_status = 'awaiting_approval' then private.order_flags(o) else '{}'::text[] end),
    'items', (select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'name', i.name, 'sku', i.sku,
        'color', i.color, 'size', i.size, 'unit_price', i.unit_price, 'quantity', i.quantity) order by i.name, i.sku)
      from public.order_items i where i.order_id = o.id),
    'addresses', (select jsonb_object_agg(a.kind, to_jsonb(a) - 'order_id' - 'kind')
      from public.order_addresses a where a.order_id = o.id),
    'collected_as', (select y.collected_as from public.payments y where y.order_id = o.id),
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'amount', t.amount,
        'reference', t.reference, 'matched_at', t.matched_at, 'matched_by', m.full_name,
        'confirmed_at', t.confirmed_at, 'confirmed_by', c.full_name) order by t.matched_at, t.id)
      from public.bank_transfers t join public.payments y on y.id = t.payment_id
      join public.profiles m on m.id = t.matched_by
      left join public.profiles c on c.id = t.confirmed_by
      where y.order_id = o.id), '[]'::jsonb),
    'needs_refund', private.needs_refund(o),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount,
        'paid_amount', a.paid_amount, 'installments', a.installments, 'status', a.status,
        'ref', a.provider_ref, 'error_code', a.error_code, 'created_at', a.created_at)
        order by a.created_at, a.id)
      from public.payment_attempts a join public.payments y on y.id = a.payment_id
      where y.order_id = o.id), '[]'::jsonb),
    'shipment', (select jsonb_build_object('id', s.id, 'our_ref', s.our_ref, 'status', s.status,
        'carrier_id', s.carrier_id, 'carrier', c.name, 'tracking_no', s.tracking_no,
        'url', private.tracking_url(c.url_template, s.tracking_no), 'handed_over_at', s.handed_over_at,
        'closed_at', s.closed_at)
      from public.shipments s left join public.carriers c on c.id = s.carrier_id
      where s.order_id = o.id and s.status <> 'cancelled'),
    'shipment_events', coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'ref', s.our_ref,
        'field', e.field, 'from', e.from_value, 'to', e.to_value, 'actor', p.full_name, 'at', e.created_at) order by e.seq)
      from public.shipment_events e join public.shipments s on s.id = e.shipment_id
      left join public.profiles p on p.id = e.actor_id where s.order_id = o.id), '[]'::jsonb),
    'cod', (select jsonb_build_object('id', x.id, 'expected', x.expected, 'status', x.status,
        'receipts', coalesce((select jsonb_agg(jsonb_build_object('seq', r.seq, 'amount', r.amount,
          'reference', r.reference, 'by', p.full_name, 'at', r.created_at) order by r.seq)
          from public.cod_receipts r join public.profiles p on p.id = r.recorded_by
          where r.settlement_id = x.id), '[]'::jsonb))
      from public.cod_settlements x join public.shipments s on s.id = x.shipment_id where s.order_id = o.id),
    'history', (select jsonb_agg(jsonb_build_object('seq', h.seq, 'field', h.field, 'from', h.from_value,
        'to', h.to_value, 'note', h.note, 'actor', p.full_name, 'at', h.created_at) order by h.seq)
      from public.order_status_history h left join public.profiles p on p.id = h.actor_id
      where h.order_id = o.id));
end;
$function$;

-- Kargoya verilen siparişin iletisinde takip bilgisi.
create or replace function public.claim_emails()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.outbox_jobs;
  o public.orders;
begin
  for j in
    select * from public.outbox_jobs
    where status = 'pending' and run_after <= now()
    order by run_after, id limit 10 for update skip locked
  loop
    update public.outbox_jobs set attempts = attempts + 1, run_after = now() + interval '5 minutes'
    where id = j.id;
    select * into o from public.orders where id = (j.payload ->> 'order_id')::uuid;
    return next jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.payload ->> 'status',
      'email', o.email, 'name', o.contact_name, 'order_no', o.order_no, 'total', o.total,
      'payment_method', o.payment_method, 'delivery_method', o.delivery_method,
      'shipment', (select jsonb_build_object('carrier', c.name, 'tracking_no', s.tracking_no,
          'url', private.tracking_url(c.url_template, s.tracking_no))
        from public.shipments s join public.carriers c on c.id = s.carrier_id
        where s.order_id = o.id and s.status = 'handed_over'),
      'token', case when o.user_id is null then private.new_order_token(o.id) end);
  end loop;
end;
$function$;

-- p_status = cod: kapıda ödeme parası tamam olmayanlar.
create or replace function public.list_orders(p_status text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_page integer DEFAULT 1)
 RETURNS TABLE(id uuid, order_no text, created_at timestamp with time zone, contact_name text, order_status text, payment_status text, payment_method text, delivery_method text, total bigint, flags text[], overdue boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('orders.read');
  return query
  select o.id, o.order_no, o.created_at, o.contact_name, o.order_status, o.payment_status,
    o.payment_method, o.delivery_method, o.total,
    case when o.order_status = 'awaiting_approval' then private.order_flags(o) else '{}'::text[] end,
    coalesce(o.order_status = 'ready_for_pickup'
      and o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer) < now(), false)
  from public.orders o
  where (p_status is null or o.order_status = p_status or (p_status = 'refund' and private.needs_refund(o))
      or (p_status = 'cod' and private.cod_open(o.id)))
    and (nullif(btrim(p_query), '') is null
      or o.order_no = upper(btrim(p_query)) or o.phone = btrim(p_query) or o.email = lower(btrim(p_query))
      or strpos(private.fold_tr(o.contact_name), private.fold_tr(btrim(p_query))) > 0)
  order by o.created_at desc, o.id
  limit 26 offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 25;
end;
$function$;

-- Özet: kapıda ödeme parası beklenenler.
drop function public.order_summary();
create or replace function public.order_summary()
 RETURNS TABLE(awaiting bigint, review bigint, refund bigint, overdue bigint, cod bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('orders.read');
  return query
  select count(*) filter (where o.order_status = 'awaiting_approval'),
    count(*) filter (where o.payment_status = 'review'),
    count(*) filter (where private.needs_refund(o)),
    count(*) filter (where o.order_status = 'ready_for_pickup'
      and o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer) < now()),
    count(*) filter (where private.cod_open(o.id))
  from public.orders o;
end;
$function$;
revoke all on function public.order_summary() from public, anon, authenticated, service_role;
grant execute on function public.order_summary() to authenticated;
