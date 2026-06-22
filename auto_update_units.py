import pandas as pd
import glob
import os
import re

def get_prefix(org_name):
    """根據機關名稱決定系統代碼字首"""
    if not isinstance(org_name, str):
        return 'XX'
    if '高雄' in org_name:
        return 'KH'
    elif '臺南' in org_name or '台南' in org_name:
        return 'TN'
    elif '嘉義' in org_name:
        return 'CY'
    elif '臺北' in org_name or '台北' in org_name:
        return 'TP'
    elif '新北' in org_name:
        return 'NTP'
    elif '桃園' in org_name:
        return 'TY'
    elif '台中' in org_name or '臺中' in org_name:
        return 'TC'
    return 'XX'

def generate_new_code(prefix, existing_codes):
    """產生新的系統代碼 (例如 KH012 -> KH013)"""
    max_num = 0
    pattern = re.compile(f"^{prefix}(\d+)$")
    
    for code in existing_codes:
        if pd.notna(code):
            match = pattern.match(str(code))
            if match:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
                    
    return f"{prefix}{max_num + 1:03d}"

def auto_update_units():
    unit_file = r'整理後_單位資料.csv' # 對應您目前的檔案
    
    # 讀取現有的單位資料
    if os.path.exists(unit_file):
        try:
            unit_df = pd.read_csv(unit_file, encoding='utf-8')
        except UnicodeDecodeError:
            try:
                unit_df = pd.read_csv(unit_file, encoding='big5')
            except UnicodeDecodeError:
                unit_df = pd.read_csv(unit_file, encoding='cp950')
    else:
        # fallback to 單位資料.csv
        unit_file = r'單位資料.csv'
        if os.path.exists(unit_file):
            try:
                unit_df = pd.read_csv(unit_file, encoding='utf-8')
            except UnicodeDecodeError:
                unit_df = pd.read_csv(unit_file, encoding='big5')
        else:
            unit_df = pd.DataFrame(columns=['機關名稱', '所屬大隊/分類', '單位名稱', '系統代碼'])

    existing_units_set = set(zip(unit_df['機關名稱'], unit_df['所屬大隊/分類'], unit_df['單位名稱']))
    existing_codes = unit_df['系統代碼'].tolist()
    
    # 尋找並讀取所有的人員名冊
    roster_files = glob.glob('*人員名冊*.csv')
    if not roster_files:
        print("目前資料夾中找不到包含「人員名冊」的 CSV 檔案。 (No roster files found)")
        return

    new_units_to_add = []
    
    for roster_file in roster_files:
        try:
            roster_df = pd.read_csv(roster_file, encoding='utf-8')
        except UnicodeDecodeError:
            try:
                roster_df = pd.read_csv(roster_file, encoding='big5')
            except UnicodeDecodeError:
                roster_df = pd.read_csv(roster_file, encoding='cp950')
        
        unique_units = roster_df[['機關名稱', '大隊', '分隊']].drop_duplicates()
        unique_units = unique_units.rename(columns={'大隊': '所屬大隊/分類', '分隊': '單位名稱'})
        unique_units['單位名稱'] = unique_units['單位名稱'].fillna(unique_units['所屬大隊/分類'])
        unique_units = unique_units.drop_duplicates()
        
        for _, row in unique_units.iterrows():
            org = row['機關名稱']
            brigade = row['所屬大隊/分類']
            unit = row['單位名稱']
            
            if pd.notna(unit) and unit == brigade:
                check_tuple = (org, brigade, '大隊本部')
                if check_tuple in existing_units_set:
                    continue
            
            unit_tuple = (org, brigade, unit)
            if unit_tuple not in existing_units_set:
                new_units_to_add.append({
                    '機關名稱': org,
                    '所屬大隊/分類': brigade,
                    '單位名稱': unit,
                    '系統代碼': ''
                })
                existing_units_set.add(unit_tuple)

    if new_units_to_add:
        new_df = pd.DataFrame(new_units_to_add)
        
        for idx, row in new_df.iterrows():
            prefix = get_prefix(row['機關名稱'])
            new_code = generate_new_code(prefix, existing_codes)
            new_df.at[idx, '系統代碼'] = new_code
            existing_codes.append(new_code)
            
        print(f"成功分析！發現 {len(new_df)} 個新單位。(Found {len(new_df)} new units)")
        
        final_df = pd.concat([unit_df, new_df], ignore_index=True)
        if os.path.exists(unit_file):
            import shutil
            shutil.copy(unit_file, unit_file.replace('.csv', '_backup.csv'))
            
        final_df.to_csv(unit_file, index=False, encoding='utf-8-sig')
        print(f"已經更新至 {unit_file}。 (Updated {unit_file})")
    else:
        print("分析完成！無新單位。(No new units found)")

if __name__ == '__main__':
    auto_update_units()
    input("按下 Enter 鍵結束... (Press Enter to exit)")
