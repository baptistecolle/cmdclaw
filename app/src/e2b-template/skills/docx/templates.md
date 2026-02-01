# DOCX Template Filling Guide

## Overview

This guide covers filling DOCX templates that use placeholder text (e.g., `{{name}}`, `{company}`) with actual values. This is the DOCX equivalent of PDF form filling.

## Simple Placeholder Replacement

For templates with `{{placeholder}}` style markers:

```python
from docx import Document

def fill_template(template_path, output_path, replacements):
    """
    Fill a DOCX template by replacing placeholder text.

    replacements: dict like {"{{name}}": "John Doe", "{{date}}": "2025-01-01"}
    """
    doc = Document(template_path)

    for para in doc.paragraphs:
        for key, value in replacements.items():
            if key in para.text:
                # Rebuild paragraph preserving formatting
                for run in para.runs:
                    if key in run.text:
                        run.text = run.text.replace(key, value)

    # Also replace in tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for key, value in replacements.items():
                        for run in para.runs:
                            if key in run.text:
                                run.text = run.text.replace(key, value)

    # Also replace in headers/footers
    for section in doc.sections:
        for para in section.header.paragraphs:
            for key, value in replacements.items():
                for run in para.runs:
                    if key in run.text:
                        run.text = run.text.replace(key, value)
        for para in section.footer.paragraphs:
            for key, value in replacements.items():
                for run in para.runs:
                    if key in run.text:
                        run.text = run.text.replace(key, value)

    doc.save(output_path)

# Usage
replacements = {
    "{{name}}": "John Doe",
    "{{company}}": "Acme Corp",
    "{{date}}": "January 15, 2025",
    "{{address}}": "123 Main Street",
}
fill_template("template.docx", "filled.docx", replacements)
```

## Handling Split Runs

Word sometimes splits placeholder text across multiple runs (e.g., `{{na` in one run, `me}}` in another). This function handles that:

```python
import re
from docx import Document

def replace_across_runs(paragraph, key, value):
    """Replace placeholder text that may be split across multiple runs."""
    full_text = paragraph.text
    if key not in full_text:
        return False

    # Find which runs contain parts of the key
    runs = paragraph.runs
    run_texts = [run.text for run in runs]

    # Rebuild: concatenate all run texts, find and replace, then redistribute
    combined = "".join(run_texts)
    if key not in combined:
        return False

    new_combined = combined.replace(key, value)

    # Clear all runs and put new text in the first run
    if runs:
        runs[0].text = new_combined
        for run in runs[1:]:
            run.text = ""

    return True

def fill_template_robust(template_path, output_path, replacements):
    """Fill template handling placeholders split across runs."""
    doc = Document(template_path)

    all_paragraphs = []
    # Collect paragraphs from body, tables, headers, footers
    all_paragraphs.extend(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                all_paragraphs.extend(cell.paragraphs)
    for section in doc.sections:
        all_paragraphs.extend(section.header.paragraphs)
        all_paragraphs.extend(section.footer.paragraphs)

    for para in all_paragraphs:
        for key, value in replacements.items():
            replace_across_runs(para, key, value)

    doc.save(output_path)
```

## Filling Tables Dynamically

For templates where you need to add rows to an existing table:

```python
from docx import Document
from docx.shared import Pt
from copy import deepcopy

def fill_table_rows(doc, table_index, data, start_row=1):
    """
    Fill a table with data rows, adding new rows as needed.

    data: list of lists, e.g. [["Alice", "30"], ["Bob", "25"]]
    start_row: row index where data begins (1 = after header)
    """
    table = doc.tables[table_index]

    for i, row_data in enumerate(data):
        if start_row + i < len(table.rows):
            row = table.rows[start_row + i]
        else:
            row = table.add_row()

        for j, value in enumerate(row_data):
            if j < len(row.cells):
                row.cells[j].text = str(value)

# Usage
doc = Document("template.docx")
data = [
    ["Widget A", "100", "$5.00", "$500.00"],
    ["Widget B", "50", "$10.00", "$500.00"],
    ["Widget C", "200", "$2.50", "$500.00"],
]
fill_table_rows(doc, table_index=0, data=data)
doc.save("filled.docx")
```

## Extract Placeholders from a Template

Use this to discover all placeholders in a template before filling:

```python
import re
from docx import Document

def find_placeholders(doc_path, pattern=r"\{\{(\w+)\}\}"):
    """Find all placeholder names in a DOCX template."""
    doc = Document(doc_path)
    placeholders = set()

    all_paragraphs = list(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                all_paragraphs.extend(cell.paragraphs)
    for section in doc.sections:
        all_paragraphs.extend(section.header.paragraphs)
        all_paragraphs.extend(section.footer.paragraphs)

    for para in all_paragraphs:
        matches = re.findall(pattern, para.text)
        placeholders.update(matches)

    return sorted(placeholders)

# Usage
fields = find_placeholders("template.docx")
print("Placeholders found:", fields)
# Output: ['address', 'company', 'date', 'name']
```
