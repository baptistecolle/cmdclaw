---
name: anvil-pdf-template-fill
description: Create and use Anvil PDF templates programmatically. Use when you need to (1) upload a PDF and create an API-fillable Anvil template, (2) save template metadata and example payload locally, or (3) generate filled PDFs from a template ID/metadata and payload JSON.
---

# Anvil PDF Template + Fill

Use these scripts to manage Anvil PDF templates end-to-end from the terminal.

## Scripts

- `scripts/create_anvil_template.py`
- `scripts/fill_anvil_template.py`

## Prerequisite

Set `ANVIL_API_KEY` in your environment (for example in `.env`):

```bash
set -a; source .env; set +a
```

## 1) Create template from PDF and save metadata + example payload

```bash
python3 skills/anvil-pdf-template-fill/scripts/create_anvil_template.py \
  --pdf "Dispositions_Particulieres_Auto_574796096.pdf" \
  --title "QUESTIONNAIRE ASSURANCE AUTOMOBILE" \
  --output-dir output/anvil_templates
```

Outputs:
- `*.template.json`: template metadata (includes template ID/name/title/field info)
- `*.example-payload.json`: starter payload for fill API

## 2) Fill PDF from saved template metadata + payload

```bash
python3 skills/anvil-pdf-template-fill/scripts/fill_anvil_template.py \
  --template-metadata output/anvil_templates/<file>.template.json \
  --payload output/auto_questionnaire_data.json \
  --out output/auto_questionnaire_filled_from_skill.pdf
```

Notes:
- Interactive (editable) output fields are enabled by default.
- Pass `--no-interactive` to flatten output.
- Pass `--default-read-only` to keep fields interactive but locked by default.
