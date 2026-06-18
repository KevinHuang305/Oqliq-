import pandas as pd

# 讀取剛剛產生的人員名冊
df = pd.read_csv('d:/CASE/Oqliq身材測量工具/人員名冊_高雄.csv')

# 取得唯一的 機關名稱, 大隊, 分隊 組合
unique_units = df[['機關名稱', '大隊', '分隊']].drop_duplicates()

# 自訂排序權重：局本部 -> 第一~第六大隊 -> 特搜大隊
def get_brigade_order(brigade):
    if '局本部' in brigade: return 0
    if '一' in brigade: return 1
    if '二' in brigade: return 2
    if '三' in brigade: return 3
    if '四' in brigade: return 4
    if '五' in brigade: return 5
    if '六' in brigade: return 6
    if '特搜' in brigade: return 99
    return 10

def get_unit_order(unit):
    if '本部' in unit: return 0
    if '專責' in unit: return 1
    if '第一' in unit or '一中隊' in unit: return 2
    if '第二' in unit or '二中隊' in unit: return 3
    if '第三' in unit or '三中隊' in unit: return 4
    return 10

unique_units['b_order'] = unique_units['大隊'].apply(get_brigade_order)
unique_units['u_order'] = unique_units['分隊'].apply(get_unit_order)

unique_units = unique_units.sort_values(['b_order', 'u_order', '大隊', '分隊']).reset_index(drop=True)
unique_units = unique_units[['機關名稱', '大隊', '分隊']]

# 產生系統代碼 (例如 KH001, KH002 ...)
unique_units['系統代碼'] = [f"KH{str(i+1).zfill(3)}" for i in range(len(unique_units))]

# 重新命名欄位以符合系統的設定
unique_units.columns = ['機關名稱', '大隊/分類', '單位名稱', '系統代碼']

unique_units.to_csv('d:/CASE/Oqliq身材測量工具/單位資料_高雄.csv', index=False, encoding='utf-8-sig')
print("Done! Created 單位資料_高雄.csv")
