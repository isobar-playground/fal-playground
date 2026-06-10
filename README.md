# 🍌 Fal Prompt Playground — PROTOTYP

Throwaway narzędzie, które pozwala **nietechnicznym osobom testować prompty na Fal.ai**
(rodzina nano-banana + GPT Image od OpenAI) — w całości w przeglądarce, bez backendu.

> ⚠️ To prototyp. Klucz Fal trzymany jest w `localStorage` przeglądarki i leci
> bezpośrednio do fal.ai z przeglądarki użytkownika. Brak obsługi błędów klasy
> produkcyjnej, brak testów. Patrz [NOTES.md](NOTES.md).

## Uruchomienie lokalne

```bash
pnpm install   # już zrobione w tym repo
pnpm dev       # http://localhost:3000
```

To wszystko — jedna komenda. Cały przepływ działa po stronie klienta.

## Przepływ (zgodny ze specyfikacją)

1. **Klucz Fal** — wpisz raz, zapisuje się w przeglądarce (`localStorage`).
2. **Referencje** — wgraj dowolną liczbę grafik (opcjonalnie; używają ich modele „edycja”).
3. **Prompt** — wpisz i opcjonalnie „Zapisz do historii” (`sessionStorage`, klik = wczytaj).
4. **Modele** — zaznacz modele (multi-select). Dla GPT Image: jakość + rozmiar. Liczba obrazów per model.
5. **Koszt** — pasek na dole pokazuje szacunkowy koszt (cennik z czerwca 2026, na obraz).
6. **Generuj** — request leci do Fal równolegle dla każdego modelu; widać logi/postęp.
7. **Wyniki** — URL-e obrazów zapisują się w `localStorage`. Możesz „↑ jako referencja”,
   żeby użyć wygenerowanego obrazu jako referencji do kolejnej generacji.

## Modele w zestawie

| Endpoint Fal | Tryb | Szac. koszt / obraz |
| --- | --- | --- |
| `fal-ai/nano-banana` | generowanie | $0.039 |
| `fal-ai/nano-banana/edit` | edycja (referencje) | $0.039 |
| `fal-ai/gpt-image-1/text-to-image` | generowanie | $0.011–$0.25 (jakość×rozmiar) |
| `fal-ai/gpt-image-1/edit-image` | edycja (referencje) | $0.011–$0.25 (jakość×rozmiar) |

Dodanie kolejnego modelu = jeden wpis w [lib/models.ts](lib/models.ts).

## Deploy na Vercel

Brak zmiennych środowiskowych (klucz podaje użytkownik w UI).

```bash
# wariant CLI
npx vercel        # preview
npx vercel --prod # produkcja
```

Albo: wrzuć repo na GitHub i zaimportuj w panelu Vercel — framework wykryje się jako Next.js.

## Uwaga o bezpieczeństwie / CORS

Klucz Fal jest „bring-your-own” i woła fal.ai bezpośrednio z przeglądarki. To świadomy
kompromis prototypu (narzędzie wewnętrzne, każdy używa własnego klucza). Gdyby fal.ai
zablokował CORS w przeglądarce, kolejnym krokiem jest cienki proxy Next.js (route handler)
przekazujący klucz z nagłówka — celowo **nie** zbudowane, żeby nie komplikować prototypu.
