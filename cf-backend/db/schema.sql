-- 系統設定表 (對應試算表「系統設定」)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT
);

-- 初始化預設設定
INSERT OR IGNORE INTO settings (key, value, description) VALUES ('admin_pwd', 'admin123', '管理員密碼');
INSERT OR IGNORE INTO settings (key, value, description) VALUES ('base_url', '', '系統前端發佈網址 (用於產生QR Code)');

-- 分隊箱狀態表 (對應試算表「分隊箱狀態」)
CREATE TABLE IF NOT EXISTS box_status (
    box_id TEXT PRIMARY KEY,
    status TEXT,
    tracking_no TEXT,
    last_update TEXT
);

-- 測量紀錄表 (對應試算表「測量紀錄」)
CREATE TABLE IF NOT EXISTS records (
    system_time TEXT DEFAULT (datetime('now', 'localtime')), -- 系統建檔時間
    reg_date TEXT,                                           -- 登記日期
    agency TEXT,                                             -- 機關名稱
    brigade TEXT,                                            -- 大隊/分類
    unit TEXT,                                               -- 單位名稱
    person_id TEXT,                                          -- 人員識別碼
    bag_no TEXT PRIMARY KEY,                                 -- 裝袋序號 (主鍵)
    name TEXT,                                               -- 姓名
    gender TEXT,                                             -- 性別
    age INTEGER,                                             -- 年齡
    job TEXT,                                                -- 職稱
    source TEXT,                                             -- 量測方式 / 來源
    filename TEXT,                                           -- 照片檔名
    file_url TEXT,                                           -- 照片連結
    height REAL,                                             -- 身高
    shoulder REAL,                                           -- 肩寬
    chest REAL,                                              -- 胸圍
    waist REAL,                                              -- 腰圍
    hip REAL,                                                -- 臀圍
    inseam REAL,                                             -- 褲內長
    series TEXT,                                             -- 配發系列
    sz_long TEXT,                                            -- 長袖
    sz_short TEXT,                                           -- 短袖
    sz_op_long TEXT,                                         -- 長袖操作服
    sz_op_short TEXT,                                        -- 短袖操作服
    sz_vest TEXT,                                            -- 背心
    sz_jacket TEXT,                                          -- 外套
    sz_ems_inner TEXT,                                       -- 救護外套內件
    sz_tac_jacket TEXT,                                      -- 戰術外套
    sz_pant TEXT,                                            -- 戰術褲
    sz_belt TEXT,                                            -- 褲帶
    sz_cap TEXT,                                             -- 戰術帽
    sz_shoe TEXT,                                            -- 消防靴
    status TEXT DEFAULT '待確認',                            -- 狀態 (待確認, 備料中, 已裝袋, 需複量, 有缺件)
    note TEXT,                                               -- 現場備註
    admin_note TEXT                                          -- 後台備註
);

-- 索引，加速條碼與分隊箱與機關查詢
CREATE INDEX IF NOT EXISTS idx_records_bag_no ON records(bag_no);
CREATE INDEX IF NOT EXISTS idx_records_unit ON records(agency, brigade, unit);
CREATE INDEX IF NOT EXISTS idx_records_agency ON records(agency);
