import pandas as pd
df = pd.read_excel('d:/CASE/Oqliq身材測量工具/115.05.08-高雄全局名冊.xls')
units = df['實際服務單位'].unique()
with open('d:/CASE/Oqliq身材測量工具/units.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join([str(x) for x in units]))
