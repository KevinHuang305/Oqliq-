import pandas as pd
import re

df = pd.read_excel('d:/CASE/Oqliq身材測量工具/115.05.08-高雄全局名冊.xls')
df = df.dropna(subset=['中文姓名'])

output = []
for index, row in df.iterrows():
    name = str(row['中文姓名']).strip()
    if name == 'nan':
        continue
    gender = str(row['性別']).strip()
    job = str(row['職稱']).strip()
    unit_full = str(row['實際服務單位']).strip()
    
    agency = "高雄市政府消防局"
    brigade = ""
    unit = ""
    
    if "大隊" in unit_full:
        idx = unit_full.find("大隊") + 2
        brigade = unit_full[:idx]
        remainder = unit_full[idx:]
        
        if not remainder:
            unit = "大隊本部"
        else:
            match = re.match(r'(第[一二三四五六七八九十]+中隊|特搜第[一二]分隊)(.*)', remainder)
            if match:
                prefix = match.group(1)
                sub = match.group(2)
                if "特搜" in prefix:
                    unit = remainder # 特搜大隊特搜第一分隊 -> 特搜第一分隊
                elif sub:
                    unit = sub
                else:
                    unit = remainder
            else:
                unit = remainder
    else:
        brigade = "局本部"
        if unit_full == "局本部":
            unit = "局本部"
        else:
            unit = unit_full
            
    output.append({
        "姓名": name,
        "性別": gender,
        "職稱": job,
        "機關名稱": agency,
        "大隊": brigade,
        "分隊": unit
    })

out_df = pd.DataFrame(output)
out_df.to_csv('d:/CASE/Oqliq身材測量工具/人員名冊_高雄.csv', index=False, encoding='utf-8-sig')
print("Done! Created 人員名冊_高雄.csv")
