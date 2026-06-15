import pandas as pd
df = pd.read_excel('d:/CASE/Oqliq身材測量工具/115.05.08-高雄全局名冊.xls')
with open('d:/CASE/Oqliq身材測量工具/headers.txt', 'w', encoding='utf-8') as f:
    f.write(str(df.columns.tolist()) + '\n\n')
    f.write(df.head(10).to_string())
