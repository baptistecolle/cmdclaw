---
name: docx
description: Comprehensive DOCX document manipulation toolkit for creating, reading, editing, and converting Word documents. When Claude needs to programmatically generate reports, fill templates, extract content, or manipulate Word documents.
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX Processing Guide

## Overview

This guide covers essential DOCX processing operations using python-docx. For template filling with placeholders, see templates.md.

## Quick Start

```python
from docx import Document

# Read a DOCX
doc = Document("document.docx")
for para in doc.paragraphs:
    print(para.text)
```

## Creating Documents

### Basic Document

```python
from docx import Document
from docx.shared import Inches, Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Add title
doc.add_heading("Document Title", level=0)

# Add paragraph
doc.add_paragraph("This is a simple paragraph.")

# Add formatted paragraph
para = doc.add_paragraph()
run = para.add_run("Bold text")
run.bold = True
run = para.add_run(" and ")
run = para.add_run("italic text")
run.italic = True

doc.save("output.docx")
```

### Headings and Styles

```python
doc = Document()

doc.add_heading("Heading 1", level=1)
doc.add_heading("Heading 2", level=2)
doc.add_heading("Heading 3", level=3)

# Paragraph with style
doc.add_paragraph("A quote", style="Intense Quote")
doc.add_paragraph("List item 1", style="List Bullet")
doc.add_paragraph("List item 2", style="List Bullet")
doc.add_paragraph("Step 1", style="List Number")
doc.add_paragraph("Step 2", style="List Number")

doc.save("styled.docx")
```

### Font and Paragraph Formatting

```python
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

para = doc.add_paragraph()
para.alignment = WD_ALIGN_PARAGRAPH.CENTER

run = para.add_run("Formatted Text")
run.font.name = "Arial"
run.font.size = Pt(14)
run.font.color.rgb = RGBColor(0x42, 0x24, 0xE9)
run.font.bold = True
run.font.underline = True

# Paragraph spacing
para.paragraph_format.space_before = Pt(12)
para.paragraph_format.space_after = Pt(6)
para.paragraph_format.line_spacing = Pt(18)

doc.save("formatted.docx")
```

## Tables

### Basic Table

```python
doc = Document()

table = doc.add_table(rows=3, cols=3)
table.style = "Table Grid"

# Set header row
headers = ["Name", "Age", "City"]
for i, header in enumerate(headers):
    table.rows[0].cells[i].text = header

# Add data
data = [
    ["Alice", "30", "New York"],
    ["Bob", "25", "London"],
]
for row_idx, row_data in enumerate(data):
    for col_idx, value in enumerate(row_data):
        table.rows[row_idx + 1].cells[col_idx].text = value

doc.save("table.docx")
```

### Styled Table with Merged Cells

```python
from docx.shared import Inches, Pt
from docx.oxml.ns import qn

doc = Document()
table = doc.add_table(rows=4, cols=3)
table.style = "Table Grid"

# Merge cells for a header spanning all columns
merged = table.rows[0].cells[0].merge(table.rows[0].cells[2])
merged.text = "Report Summary"

# Set column widths
for row in table.rows:
    row.cells[0].width = Inches(2)
    row.cells[1].width = Inches(2)
    row.cells[2].width = Inches(2)

doc.save("styled_table.docx")
```

## Images

```python
from docx.shared import Inches

doc = Document()
doc.add_heading("Document with Image", level=1)

# Add image with specified width
doc.add_picture("image.png", width=Inches(4))

# Add image inline in a paragraph
para = doc.add_paragraph()
run = para.add_run()
run.add_picture("icon.png", width=Inches(1))

doc.save("with_images.docx")
```

## Headers and Footers

```python
doc = Document()

# Access default header/footer
section = doc.sections[0]

# Header
header = section.header
header_para = header.paragraphs[0]
header_para.text = "Company Name"
header_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Footer
footer = section.footer
footer_para = footer.paragraphs[0]
footer_para.text = "Page "

doc.save("with_header_footer.docx")
```

## Page Setup

```python
from docx.shared import Inches, Cm
from docx.enum.section import WD_ORIENT

doc = Document()
section = doc.sections[0]

# Set margins
section.top_margin = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin = Cm(2.5)
section.right_margin = Cm(2.5)

# Set page size (A4)
section.page_width = Cm(21)
section.page_height = Cm(29.7)

# Landscape orientation
section.orientation = WD_ORIENT.LANDSCAPE
# Swap width and height for landscape
section.page_width, section.page_height = section.page_height, section.page_width

doc.save("page_setup.docx")
```

## Reading and Modifying Documents

### Extract All Text

```python
doc = Document("input.docx")

full_text = []
for para in doc.paragraphs:
    full_text.append(para.text)

print("\n".join(full_text))
```

### Extract Tables as Data

```python
import pandas as pd

doc = Document("input.docx")

for table in doc.tables:
    data = []
    for row in table.rows:
        data.append([cell.text for cell in row.cells])
    df = pd.DataFrame(data[1:], columns=data[0])
    print(df)
```

### Search and Replace Text

```python
def replace_text(doc, old_text, new_text):
    for para in doc.paragraphs:
        for run in para.runs:
            if old_text in run.text:
                run.text = run.text.replace(old_text, new_text)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        if old_text in run.text:
                            run.text = run.text.replace(old_text, new_text)

doc = Document("input.docx")
replace_text(doc, "{{company}}", "Acme Corp")
doc.save("output.docx")
```

### Modify Existing Paragraph Style

```python
doc = Document("input.docx")

for para in doc.paragraphs:
    if para.style.name == "Heading 1":
        for run in para.runs:
            run.font.color.rgb = RGBColor(0, 0, 128)
            run.font.size = Pt(20)

doc.save("modified.docx")
```

## Converting DOCX

### DOCX to PDF (via LibreOffice)

```bash
libreoffice --headless --convert-to pdf document.docx
```

### DOCX to HTML

```python
# Using mammoth for clean HTML conversion
import mammoth

with open("document.docx", "rb") as docx_file:
    result = mammoth.convert_to_html(docx_file)
    html = result.value

with open("output.html", "w") as f:
    f.write(html)
```

## Quick Reference

| Task | Method |
|------|--------|
| Create document | `Document()` |
| Open document | `Document("file.docx")` |
| Add heading | `doc.add_heading("text", level=1)` |
| Add paragraph | `doc.add_paragraph("text")` |
| Bold/italic | `run.bold = True`, `run.italic = True` |
| Add table | `doc.add_table(rows, cols)` |
| Add image | `doc.add_picture("img.png", width=Inches(4))` |
| Set font | `run.font.name`, `run.font.size` |
| Page setup | `doc.sections[0].top_margin = Cm(2)` |
| Save | `doc.save("output.docx")` |
| Convert to PDF | `libreoffice --headless --convert-to pdf` |

## Next Steps

- For filling DOCX templates with placeholders, see templates.md
