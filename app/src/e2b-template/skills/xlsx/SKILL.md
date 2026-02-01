---
name: xlsx
description: Comprehensive Excel spreadsheet manipulation toolkit for creating, reading, editing, and formatting XLSX files. When Claude needs to programmatically generate spreadsheets, process tabular data, create charts, apply formatting, or fill Excel templates.
license: Proprietary. LICENSE.txt has complete terms
---

# Excel (XLSX) Processing Guide

## Overview

This guide covers essential Excel processing operations using openpyxl. For data analysis workflows combining pandas with openpyxl, see data.md.

## Quick Start

```python
from openpyxl import load_workbook, Workbook

# Read an Excel file
wb = load_workbook("spreadsheet.xlsx")
ws = wb.active
for row in ws.iter_rows(values_only=True):
    print(row)

# Create a new Excel file
wb = Workbook()
ws = wb.active
ws["A1"] = "Hello"
wb.save("output.xlsx")
```

## Creating Workbooks

### Basic Workbook

```python
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.title = "Sales Data"

# Write headers
headers = ["Product", "Quantity", "Price", "Total"]
for col, header in enumerate(headers, 1):
    ws.cell(row=1, column=col, value=header)

# Write data
data = [
    ["Widget A", 100, 5.00, 500.00],
    ["Widget B", 50, 10.00, 500.00],
    ["Widget C", 200, 2.50, 500.00],
]
for row_idx, row_data in enumerate(data, 2):
    for col_idx, value in enumerate(row_data, 1):
        ws.cell(row=row_idx, column=col_idx, value=value)

wb.save("sales.xlsx")
```

### Multiple Sheets

```python
wb = Workbook()

# Rename default sheet
ws1 = wb.active
ws1.title = "Summary"

# Add more sheets
ws2 = wb.create_sheet("Details")
ws3 = wb.create_sheet("Charts")

# Insert sheet at specific position
ws4 = wb.create_sheet("Cover", 0)  # First position

wb.save("multi_sheet.xlsx")
```

## Cell Formatting

### Font, Fill, and Alignment

```python
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

ws["A1"] = "Header"
ws["A1"].font = Font(name="Arial", size=14, bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
ws["A1"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
```

### Borders

```python
thin_border = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)

for row in ws.iter_rows(min_row=1, max_row=10, min_col=1, max_col=5):
    for cell in row:
        cell.border = thin_border
```

### Number Formats

```python
ws["B2"].number_format = "#,##0.00"       # 1,234.56
ws["C2"].number_format = "$#,##0.00"      # $1,234.56
ws["D2"].number_format = "0.00%"          # 75.50%
ws["E2"].number_format = "YYYY-MM-DD"     # 2025-01-15
ws["F2"].number_format = "#,##0"          # 1,235
```

### Column Width and Row Height

```python
ws.column_dimensions["A"].width = 25
ws.column_dimensions["B"].width = 15
ws.row_dimensions[1].height = 30

# Auto-fit approximation
for col in ws.columns:
    max_length = 0
    col_letter = col[0].column_letter
    for cell in col:
        if cell.value:
            max_length = max(max_length, len(str(cell.value)))
    ws.column_dimensions[col_letter].width = max_length + 2
```

### Styled Header Row

```python
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

def style_header_row(ws, num_cols):
    """Apply professional styling to the first row."""
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    for col in range(1, num_cols + 1):
        cell = ws.cell(row=1, column=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    ws.row_dimensions[1].height = 25
    ws.auto_filter.ref = ws.dimensions
```

## Formulas

```python
ws["A1"] = 10
ws["A2"] = 20
ws["A3"] = 30

# SUM
ws["A4"] = "=SUM(A1:A3)"

# AVERAGE
ws["B4"] = "=AVERAGE(A1:A3)"

# IF
ws["C1"] = '=IF(A1>15,"High","Low")'

# VLOOKUP
ws["D1"] = '=VLOOKUP(A1,Sheet2!A:B,2,FALSE)'

# COUNT
ws["E4"] = "=COUNTA(A1:A3)"
```

## Merged Cells

```python
ws.merge_cells("A1:D1")
ws["A1"] = "Merged Header"
ws["A1"].alignment = Alignment(horizontal="center")

# Unmerge
ws.unmerge_cells("A1:D1")
```

## Freeze Panes

```python
# Freeze first row (header)
ws.freeze_panes = "A2"

# Freeze first column
ws.freeze_panes = "B1"

# Freeze first row and first column
ws.freeze_panes = "B2"
```

## Charts

### Bar Chart

```python
from openpyxl.chart import BarChart, Reference

chart = BarChart()
chart.title = "Sales by Product"
chart.x_axis.title = "Product"
chart.y_axis.title = "Revenue"
chart.style = 10

data = Reference(ws, min_col=2, min_row=1, max_row=5, max_col=2)
categories = Reference(ws, min_col=1, min_row=2, max_row=5)

chart.add_data(data, titles_from_data=True)
chart.set_categories(categories)
chart.shape = 4

ws.add_chart(chart, "E2")
```

### Line Chart

```python
from openpyxl.chart import LineChart, Reference

chart = LineChart()
chart.title = "Monthly Trend"
chart.x_axis.title = "Month"
chart.y_axis.title = "Value"

data = Reference(ws, min_col=2, min_row=1, max_row=13, max_col=3)
categories = Reference(ws, min_col=1, min_row=2, max_row=13)

chart.add_data(data, titles_from_data=True)
chart.set_categories(categories)

ws.add_chart(chart, "E2")
```

### Pie Chart

```python
from openpyxl.chart import PieChart, Reference

chart = PieChart()
chart.title = "Market Share"

data = Reference(ws, min_col=2, min_row=1, max_row=5)
labels = Reference(ws, min_col=1, min_row=2, max_row=5)

chart.add_data(data, titles_from_data=True)
chart.set_categories(labels)

ws.add_chart(chart, "D2")
```

## Conditional Formatting

```python
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule
from openpyxl.styles import PatternFill

# Highlight cells greater than 100
red_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
ws.conditional_formatting.add(
    "B2:B100",
    CellIsRule(operator="greaterThan", formula=["100"], fill=red_fill),
)

# Color scale (green to red)
ws.conditional_formatting.add(
    "C2:C100",
    ColorScaleRule(
        start_type="min", start_color="63BE7B",
        end_type="max", end_color="F8696B",
    ),
)

# Data bars
ws.conditional_formatting.add(
    "D2:D100",
    DataBarRule(start_type="min", end_type="max", color="4472C4"),
)
```

## Data Validation

```python
from openpyxl.worksheet.datavalidation import DataValidation

# Dropdown list
dv = DataValidation(
    type="list",
    formula1='"Low,Medium,High"',
    allow_blank=True,
)
dv.prompt = "Select priority"
dv.promptTitle = "Priority"
ws.add_data_validation(dv)
dv.add("E2:E100")

# Number range
dv_num = DataValidation(type="whole", operator="between", formula1=0, formula2=100)
dv_num.error = "Value must be between 0 and 100"
ws.add_data_validation(dv_num)
dv_num.add("F2:F100")
```

## Reading and Modifying

### Read Specific Ranges

```python
wb = load_workbook("data.xlsx")
ws = wb.active

# Read a specific cell
value = ws["B3"].value

# Read a range
for row in ws.iter_rows(min_row=2, max_row=10, min_col=1, max_col=4, values_only=True):
    print(row)

# Read all data
data = list(ws.values)
headers = data[0]
rows = data[1:]
```

### Modify Existing File

```python
wb = load_workbook("existing.xlsx")
ws = wb.active

# Update a cell
ws["C5"] = 42

# Insert rows
ws.insert_rows(3, amount=2)

# Delete rows
ws.delete_rows(6, amount=1)

# Insert columns
ws.insert_cols(2, amount=1)

wb.save("modified.xlsx")
```

### Copy Sheet

```python
wb = load_workbook("source.xlsx")
source = wb.active
target = wb.copy_worksheet(source)
target.title = "Copy of " + source.title
wb.save("with_copy.xlsx")
```

## Print Setup

```python
ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0  # 0 = as many pages as needed
ws.page_setup.orientation = "landscape"

# Print titles (repeat header row on each page)
ws.print_title_rows = "1:1"

# Print area
ws.print_area = "A1:F50"
```

## Images

```python
from openpyxl.drawing.image import Image

img = Image("logo.png")
img.width = 200
img.height = 100
ws.add_image(img, "A1")
```

## Quick Reference

| Task | Method |
|------|--------|
| Create workbook | `Workbook()` |
| Open workbook | `load_workbook("file.xlsx")` |
| Active sheet | `wb.active` |
| Write cell | `ws["A1"] = value` or `ws.cell(row, col, value)` |
| Read cell | `ws["A1"].value` |
| Add sheet | `wb.create_sheet("Name")` |
| Bold font | `cell.font = Font(bold=True)` |
| Fill color | `cell.fill = PatternFill(...)` |
| Add formula | `ws["A1"] = "=SUM(B1:B10)"` |
| Merge cells | `ws.merge_cells("A1:D1")` |
| Freeze panes | `ws.freeze_panes = "A2"` |
| Column width | `ws.column_dimensions["A"].width = 20` |
| Auto filter | `ws.auto_filter.ref = ws.dimensions` |
| Add chart | `ws.add_chart(chart, "E2")` |
| Save | `wb.save("output.xlsx")` |

## Next Steps

- For pandas + openpyxl data workflows, see data.md
