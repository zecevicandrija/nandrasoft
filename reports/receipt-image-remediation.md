# Bezbedna obrada fotografija računa — 31.10.2026.

Radnik i dalje fotografiše račun ili bira sliku iz galerije. Ne podešava
dimenzije, format ili kvalitet. Pregledač automatski priprema sliku do 2560 px
po dužoj strani, sa kvalitetom 0.88. Ako ne može da dekodira fotografiju
(npr. HEIC), šalje original na serversku konverziju. Pri zauzetom uploadu
automatski ponavlja zahtev do tri puta, sa pauzama od tri sekunde.

Oba endpointa, `/api/fuel/upload` i `/api/fuel/upload-fallback`, koriste isti
postupak. Format se prepoznaje po bajtovima: JPEG, PNG, WebP, HEIC/HEIF ili
AVIF. Ime fajla i MIME koje navodi klijent ne određuju format skladištenja.
Potpis nije dovoljna validacija: slika se zatim dekodira i ponovo kodira u
JPEG, uz automatsku orijentaciju, belu pozadinu, uklanjanje metapodataka i
proporcionalno smanjivanje bez isecanja ili povećavanja. Oštećena slika se
odbija pre pristupa skladištu. HEIC koristi `heic-decode`, jer standardni
Sharp binarni paketi nemaju HEVC dekoder.

Naziv na skladištu je serverski `crypto.randomUUID()`, sa stvarnom `.jpg`
ekstenzijom i `image/jpeg` tipom. Klijent ne bira putanju; dodatna multipart
polja se odbijaju. Kredencijali ostaju na serveru.

## CPU i memorija

Po Node.js procesu dozvoljene su najviše tri aktivne upload operacije,
uključujući prijem fajla, čekanje obrade i slanje skladištu. Ograničenje se
proverava pre nego što Multer alocira bafer. Višak zahteva dobija 503 i
`Retry-After: 3`.

Dekodiranje se izvršava serijski u zasebnom worker thread-u. Sharp koristi
jednu nit za obradu i isključen keš. Time se HTTP event loop oslobađa
dekodiranja, a HEIC memorija oslobađa završavanjem worker-a posle posla.
Worker ima ograničenje V8 heap-a od 128 MiB; to nije ograničenje ukupne RSS
memorije ili memorije native/WASM dekodera.

Interni plafoni su 32 MiB ulaznih bajtova i 120 miliona ulaznih piksela,
Sharp timeout 20 sekundi i worker timeout 30 sekundi. HEIC dimenzije se
proveravaju pre alokacije izlaznih RGBA piksela. Ovo su zaštite resursa;
nisu zahtevi da radnik ručno menja sliku. Fotografije koje pregledač uspešno
obradi stižu već smanjene. Ekstremni ili oštećeni originali i dalje mogu
biti odbijeni. Maksimalnu potrošnju za velike originale treba proveriti na
ciljnom VPS-u; više Node procesa ima odvojene limite.

## Provera

`node --test tests/receipt-upload.test.js tests/worker-identity.test.js tests/work-order-access.test.js`
prolazi: 33 testa. Pokriveni su stvarna konverzija HEIC primera, JPEG/PNG/
WebP/AVIF, rotacija fotografije od 12 MP, uklanjanje metapodataka, lažni i
oštećeni fajlovi, prevelike dimenzije/bajtovi, jedinstvene putanje,
istovremeni zahtevi i oporavak kapaciteta. Storage zahtevi su mockovani.
Frontend `npm.cmd run build` prolazi.

Lokalno merenje jednog prolaza (nije VPS benchmark): sintetička jednostavna
12 MP JPEG slika 128 ms elapsed / 124 ms CPU, uz uzorkovani vršni RSS celog
procesa oko 122 MiB; HEIC primer od oko 701 KiB 227 ms elapsed / 313 ms CPU,
RSS oko 110 MiB. Slika sa više detalja i drugi hardver daju druge rezultate.

Na VPS-u pokrenuti `node scripts/benchmark-receipt-images.js putanja/do/slike.jpg`
sa reprezentativnim fotografijama. Skripta meri samo lokalnu obradu, bez
baze ili uploada na skladište. RSS se uzorkuje na 10 ms i može propustiti
kratke vrhove. Za deployment instalirati nove zavisnosti preko `npm ci`
(uključujući optional Sharp pakete). Reverse proxy mora dozvoliti originalne
fotografije do 32 MiB plus multipart overhead ako se koristi serverski fallback.
