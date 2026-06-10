# Prototype notes

## Pytanie, na które odpowiada ten prototyp

> Czy nietechniczna osoba — mając **tylko własny klucz Fal** — może w całości w przeglądarce
> przejść pętlę: referencje → prompt → wybór modeli → podgląd kosztu → generacja → wyniki,
> i użyć wygenerowanego obrazu jako referencji w następnej rundzie?

Założenie projektowe: **brak backendu**. Klucz i historia żyją w `localStorage` /
`sessionStorage`; requesty lecą bezpośrednio do fal.ai z przeglądarki.

## Co celowo pominięto (bo to prototyp)

- Brak testów, brak twardej obsługi błędów (błędy per-model lądują w karcie wyniku).
- Cennik jest **zaszyty na sztywno** (czerwiec 2026) — to szacunek, nie źródło prawdy.
  Fal nie udostępnia prostego „cost estimate API”, więc liczymy lokalnie cena×liczba_obrazów.
- Brak proxy serwerowego — patrz uwaga o CORS w README. Jeśli przeglądarka zostanie
  zablokowana przez CORS przy bezpośrednim wywołaniu fal.ai, to pierwszy element do dobudowania.
- Referencje (pliki) nie są persystowane — tylko ich URL-e po uploadzie w obrębie runu.

## Werdykt (do uzupełnienia po przeklikaniu z realnym kluczem)

- [ ] Czy bezpośrednie wywołania fal.ai z przeglądarki przechodzą (CORS, upload, subscribe)?
- [ ] Czy `fal-ai/gpt-image-1/edit-image` działa na samym kluczu Fal (bez BYOK OpenAI)?
- [ ] Czy szacunek kosztu zgadza się z faktycznym naliczeniem Fal?
- [ ] Czy przepływ jest zrozumiały dla osoby nietechnicznej bez instrukcji?

> Po odpowiedzeniu na powyższe: albo przepisać walidowane decyzje do „prawdziwej” wersji
> (z proxy + obsługą błędów), albo usunąć prototyp.
