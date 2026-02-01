# Excel Data Workflows with Pandas + openpyxl

## Overview

Combine pandas for data manipulation with openpyxl for Excel-specific formatting. This guide covers common data processing patterns.

## Reading Excel Data into Pandas

```python
import pandas as pd

# Read default sheet
df = pd.read_excel("data.xlsx")

# Read specific sheet
df = pd.read_excel("data.xlsx", sheet_name="Sales")

# Read multiple sheets
sheets = pd.read_excel("data.xlsx", sheet_name=None)  # dict of DataFrames
for name, df in sheets.items():
    print(f"Sheet: {name}, Rows: {len(df)}")

# Read with options
df = pd.read_excel(
    "data.xlsx",
    header=0,           # Row to use as header (0-indexed)
    usecols="A:D",      # Only read columns A-D
    skiprows=2,          # Skip first 2 rows
    dtype={"ID": str},   # Force column types
)
```

## Writing Styled DataFrames to Excel

```python
import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

df = pd.DataFrame({
    "Product": ["Widget A", "Widget B", "Widget C"],
    "Quantity": [100, 50, 200],
    "Price": [5.00, 10.00, 2.50],
    "Total": [500.00, 500.00, 500.00],
})

# Write with pandas, then style with openpyxl
with pd.ExcelWriter("report.xlsx", engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="Sales", index=False)

    ws = writer.sheets["Sales"]

    # Style header
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    # Format currency columns
    for row in ws.iter_rows(min_row=2, min_col=3, max_col=4):
        for cell in row:
            cell.number_format = "$#,##0.00"

    # Auto-fit columns
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        ws.column_dimensions[col[0].column_letter].width = max_len + 3

    # Add total row
    last_row = len(df) + 2
    ws.cell(row=last_row, column=1, value="Total").font = Font(bold=True)
    ws.cell(row=last_row, column=4, value=f"=SUM(D2:D{last_row-1})")
    ws.cell(row=last_row, column=4).number_format = "$#,##0.00"
    ws.cell(row=last_row, column=4).font = Font(bold=True)
```

## Multiple DataFrames to Multiple Sheets

```python
dfs = {
    "Q1": pd.DataFrame({"Month": ["Jan", "Feb", "Mar"], "Revenue": [1000, 1200, 1100]}),
    "Q2": pd.DataFrame({"Month": ["Apr", "May", "Jun"], "Revenue": [1300, 1400, 1250]}),
    "Summary": pd.DataFrame({"Quarter": ["Q1", "Q2"], "Total": [3300, 3950]}),
}

with pd.ExcelWriter("quarterly.xlsx", engine="openpyxl") as writer:
    for sheet_name, df in dfs.items():
        df.to_excel(writer, sheet_name=sheet_name, index=False)
```

## Append Data to Existing Excel

```python
from openpyxl import load_workbook

def append_df_to_excel(filepath, df, sheet_name="Sheet1"):
    """Append a DataFrame to an existing Excel sheet."""
    wb = load_workbook(filepath)
    ws = wb[sheet_name]

    # Find next empty row
    next_row = ws.max_row + 1

    for row_idx, row_data in enumerate(df.values):
        for col_idx, value in enumerate(row_data):
            ws.cell(row=next_row + row_idx, column=col_idx + 1, value=value)

    wb.save(filepath)

new_data = pd.DataFrame({"Product": ["Widget D"], "Quantity": [75], "Price": [8.00], "Total": [600.00]})
append_df_to_excel("sales.xlsx", new_data, "Sales")
```

## Pivot Table to Excel

```python
import pandas as pd

df = pd.DataFrame({
    "Region": ["East", "West", "East", "West", "East", "West"],
    "Product": ["A", "A", "B", "B", "C", "C"],
    "Sales": [100, 150, 200, 180, 90, 120],
})

pivot = df.pivot_table(values="Sales", index="Product", columns="Region", aggfunc="sum", margins=True)

with pd.ExcelWriter("pivot_report.xlsx", engine="openpyxl") as writer:
    pivot.to_excel(writer, sheet_name="Pivot")
```

## Fill Excel Template from Data

```python
from openpyxl import load_workbook

def fill_excel_template(template_path, output_path, replacements, table_data=None):
    """
    Fill an Excel template.

    replacements: dict like {"{{company}}": "Acme Corp"}
    table_data: dict like {"Sheet1": {"start_row": 5, "data": [[...], [...]]}}
    """
    wb = load_workbook(template_path)

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str):
                    for key, value in replacements.items():
                        if key in cell.value:
                            cell.value = cell.value.replace(key, str(value))

    if table_data:
        for sheet_name, config in table_data.items():
            ws = wb[sheet_name]
            start_row = config["start_row"]
            for i, row_data in enumerate(config["data"]):
                for j, value in enumerate(row_data):
                    ws.cell(row=start_row + i, column=j + 1, value=value)

    wb.save(output_path)

# Usage
fill_excel_template(
    "template.xlsx",
    "filled.xlsx",
    replacements={"{{company}}": "Acme Corp", "{{date}}": "2025-01-15"},
    table_data={
        "Invoice": {
            "start_row": 10,
            "data": [
                ["Service A", 10, 50.00, 500.00],
                ["Service B", 5, 100.00, 500.00],
            ],
        }
    },
)
```
