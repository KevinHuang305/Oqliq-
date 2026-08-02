import pandas as pd
import json

excel_file = r'd:\CASE\Oqliq身材測量工具\Old\身材測量資料庫.xlsx'
xls = pd.ExcelFile(excel_file)
print(xls.sheet_names)
