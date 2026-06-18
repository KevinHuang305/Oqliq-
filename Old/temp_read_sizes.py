import pandas as pd
import json

try:
    df = pd.read_excel('身材測量資料庫new.xlsx', sheet_name='服裝尺碼')
    df = df.fillna('')
    with open('sizes.json', 'w', encoding='utf-8') as f:
        json.dump(df.to_dict('list'), f, ensure_ascii=False)
    print("Success")
except Exception as e:
    print(f"Error: {e}")
