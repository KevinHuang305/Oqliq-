// Cloudflare Worker 後端邏輯 - Firescue (完整相容版本)
// 與 Google Apps Script (GAS) 接口 100% 格式相容，可直接作為替代後端。

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// 全域變數用於快取 Google Sheets 的靜態資料
let staticUnitsCache = null;
let staticUnitsCacheTime = 0;
let staticSizesCache = null;
let staticSizesCacheTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 快取 10 分鐘 (毫秒)

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    
    // 解析 action 參數 (相容 GET 與 POST)
    let action = url.searchParams.get('action');
    let bodyText = "";
    let params = new URLSearchParams();

    if (request.method === 'POST') {
      bodyText = await request.text();
      params = new URLSearchParams(bodyText);
      
      if (params.get('action')) {
        action = params.get('action');
      } else if (params.get('payload')) {
        try {
          const payloadObj = JSON.parse(params.get('payload'));
          if (payloadObj.action) {
            action = payloadObj.action;
          }
        } catch(e) {}
      }
    }

    // 若 URL 路徑包含具體 API，則優先以路徑解析 (例如 /api/getUnits)
    if (path.startsWith('/api/')) {
      action = path.replace('/api/', '');
    }

    // 預設 Action
    if (!action) {
      if (request.method === 'POST') {
        action = 'saveRecord'; // 預設新增紀錄
      } else {
        action = 'getUnits'; // 預設獲取單位
      }
    }

    try {
      // ==========================================
      // [GET] getSettings - 獲取系統設定
      // ==========================================
      if (action === 'getSettings') {
        const settings = await getAllSettings(env);
        return jsonResponse({ status: "success", data: settings });
      }

      // ==========================================
      // [GET] getSizesConfig - 獲取尺寸對照參數
      // ==========================================
      if (action === 'getSizesConfig') {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'sizes_config'").first();
        let config = {};
        if (row && row.value) {
          try {
            config = JSON.parse(row.value);
          } catch(e) {
            console.error("解析 D1 中的 sizes_config 失敗:", e);
          }
        }
        return jsonResponse({ status: "success", data: config });
      }

      // ==========================================
      // [GET] getUnits - 獲取單位與名冊資料
      // ==========================================
      if (action === 'getUnits') {
        // 並行查詢 D1 中的所有相關資料表，提升效能
        const [measuredRes, unitsRes, rosterRes, jobsRes] = await Promise.all([
          env.DB.prepare("SELECT agency, brigade, unit, name, bag_no, person_id FROM records").all(),
          env.DB.prepare("SELECT * FROM units").all(),
          env.DB.prepare("SELECT * FROM roster").all(),
          env.DB.prepare("SELECT * FROM jobs").all()
        ]);

        const d1Rows = measuredRes.results || [];
        const measured = d1Rows.map(r => `${r.agency}_${r.brigade}_${r.unit}_${r.name}`);
        const existingIds = [];
        d1Rows.forEach(r => {
          if (r.person_id) existingIds.push(r.person_id.trim());
          if (r.bag_no) existingIds.push(r.bag_no.trim());
        });

        // 建立機關/單位階層與代碼對照表
        const hierarchy = {};
        const systemCodes = {};
        (unitsRes.results || []).forEach(r => {
          const agency = r.agency;
          const brigade = r.brigade;
          const unit = r.unit;
          const sysCode = r.sys_code;
          if (agency && brigade && unit) {
            if (!hierarchy[agency]) hierarchy[agency] = {};
            if (!hierarchy[agency][brigade]) hierarchy[agency][brigade] = [];
            if (!hierarchy[agency][brigade].includes(unit)) hierarchy[agency][brigade].push(unit);
            systemCodes[`${agency}_${brigade}_${unit}`] = sysCode;
          }
        });

        // 格式化名冊欄位名稱以符合前端預期 (與試算表欄位一致)
        const roster = (rosterRes.results || []).map(r => ({
          "機關名稱": r.agency,
          "大隊": r.brigade,
          "分隊": r.unit,
          "姓名": r.name,
          "性別": r.gender,
          "人員識別碼": r.person_id,
          "年齡": r.age,
          "職稱": r.job
        }));

        // 提取職稱選項
        const jobs = (jobsRes.results || []).map(r => r.job);

        const mergedResult = {
          hierarchy,
          systemCodes,
          roster,
          jobs,
          measured,
          existingIds
        };

        return jsonResponse(mergedResult);
      }

      // ==========================================
      // [GET] getRecordByBagNo - 依袋號查詢個人資料
      // ==========================================
      if (action === 'getRecordByBagNo') {
        const password = url.searchParams.get('password');
        await verifyAdminPassword(env, password);

        const bagNo = url.searchParams.get('bagNo');
        if (!bagNo) return errorResponse("缺少裝袋序號", 400);

        const record = await env.DB.prepare("SELECT * FROM records WHERE bag_no = ?").bind(bagNo).first();
        if (!record) return errorResponse("找不到該筆資料", 404);

        const formattedRecord = formatRecordSizes(record);
        const boxData = await env.DB.prepare("SELECT * FROM box_status").all();
        const { boxStatuses, boxTrackingNos, boxUpdateTimes } = formatBoxStatuses(boxData.results || []);

        return jsonResponse({
          record: formattedRecord,
          boxStatuses,
          boxTrackingNos,
          boxUpdateTimes
        });
      }

      // ==========================================
      // [GET] getRecordsBySquad - 依分隊箱號查詢人員
      // ==========================================
      if (action === 'getRecordsBySquad') {
        const password = url.searchParams.get('password');
        await verifyAdminPassword(env, password);

        const box = url.searchParams.get('box');
        if (!box) return errorResponse("缺少箱號", 400);

        const unitsRes = await env.DB.prepare("SELECT * FROM units").all();
        const unitsRows = unitsRes.results || [];
        const matchingUnits = [];
        unitsRows.forEach(r => {
          const key = `${r.agency}_${r.brigade}_${r.unit}`;
          if (r.sys_code === box || key === box) {
            matchingUnits.push(key);
          }
        });

        const result = await env.DB.prepare("SELECT * FROM records").all();
        const allRows = result.results || [];
        const records = [];

        allRows.forEach(r => {
          const key = `${r.agency}_${r.brigade}_${r.unit}`;
          if (matchingUnits.includes(key) || key === box) {
            records.push(formatRecordSizes(r));
          }
        });

        const boxData = await env.DB.prepare("SELECT * FROM box_status WHERE box_id = ? OR box_id LIKE ?")
          .bind(box, `${box}%`).all();
        const { boxStatuses, boxTrackingNos, boxUpdateTimes } = formatBoxStatuses(boxData.results || []);

        return jsonResponse({
          records: records.reverse(),
          boxStatuses,
          boxTrackingNos,
          boxUpdateTimes
        });
      }

      // ==========================================
      // [GET] getRecordsByUnit - 依機關查詢人員
      // ==========================================
      if (action === 'getRecordsByUnit') {
        const password = url.searchParams.get('password');
        await verifyAdminPassword(env, password);

        const name = url.searchParams.get('name');
        if (!name) return errorResponse("缺少機關名稱", 400);

        const result = await env.DB.prepare("SELECT * FROM records WHERE agency = ?").bind(name).all();
        const records = (result.results || []).map(r => formatRecordSizes(r));

        const boxData = await env.DB.prepare("SELECT * FROM box_status WHERE box_id = ? OR box_id LIKE ?")
          .bind(name, `${name}%`).all();
        const { boxStatuses, boxTrackingNos, boxUpdateTimes } = formatBoxStatuses(boxData.results || []);

        return jsonResponse({
          records: records.reverse(),
          boxStatuses,
          boxTrackingNos,
          boxUpdateTimes
        });
      }

      // ==========================================
      // [GET] getRecords - 獲取全部紀錄 (後台專用)
      // ==========================================
      if (action === 'getRecords') {
        const password = url.searchParams.get('password');
        await verifyAdminPassword(env, password);

        const result = await env.DB.prepare("SELECT * FROM records ORDER BY system_time DESC").all();
        const records = (result.results || []).map(r => formatRecordSizes(r));

        const boxData = await env.DB.prepare("SELECT * FROM box_status").all();
        const { boxStatuses, boxTrackingNos, boxUpdateTimes } = formatBoxStatuses(boxData.results || []);

        // 從 D1 整理尺碼表選項
        const sizesRes = await env.DB.prepare("SELECT * FROM clothing_sizes").all();
        const clothingSizes = {};
        (sizesRes.results || []).forEach(r => {
          if (!clothingSizes[r.item_name]) {
            clothingSizes[r.item_name] = [];
          }
          clothingSizes[r.item_name].push(r.size_value);
        });

        return jsonResponse({
          records: records,
          boxStatuses,
          boxTrackingNos,
          boxUpdateTimes,
          clothingSizes
        });
      }

      // ==========================================
      // [POST] saveRecord (預設) - 儲存全新測量紀錄
      // ==========================================
      if (action === 'saveRecord' && request.method === 'POST') {
        const bagNo = params.get('bagNo') || '未提供';
        const personId = params.get('personId') || '未提供';
        const name = params.get('name') || '未提供';
        const regDate = params.get('regDate') || new Date().toISOString().split('T')[0];

        await env.DB.prepare(`
          INSERT INTO records (
            reg_date, agency, brigade, unit, person_id, bag_no, name, gender, age, job,
            source, filename, file_url, height, shoulder, chest, waist, hip, inseam, series,
            sz_long, sz_short, sz_op_long, sz_op_short, sz_vest, sz_jacket, sz_ems_inner, sz_tac_jacket,
            sz_pant, sz_belt, sz_cap, sz_shoe, status, note, admin_note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(bag_no) DO UPDATE SET
            status = excluded.status,
            admin_note = excluded.admin_note
        `).bind(
          regDate, params.get('agency') || '未提供', params.get('brigade') || '未提供', params.get('unit') || '未提供',
          personId, bagNo, name, params.get('gender') || '未提供', parseInt(params.get('age') || '0', 10),
          params.get('job') || '未提供', params.get('source') || '未提供', params.get('filename') || '無照片',
          params.get('fileUrl') || '無照片', parseFloat(params.get('height') || '0'), parseFloat(params.get('shoulder') || '0'),
          parseFloat(params.get('chest') || '0'), parseFloat(params.get('waist') || '0'), parseFloat(params.get('hip') || '0'),
          parseFloat(params.get('inseam') || '0'), params.get('series') || '', params.get('sz_long') || '',
          params.get('sz_short') || '', params.get('sz_op_long') || '', params.get('sz_op_short') || '',
          params.get('sz_vest') || '', params.get('sz_jacket') || '', params.get('sz_ems_inner') || '',
          params.get('sz_tac_jacket') || '', params.get('sz_pant') || '', params.get('sz_belt') || '',
          params.get('sz_cap') || '', params.get('sz_shoe') || '', params.get('status') || '待確認',
          params.get('note') || '', params.get('adminNote') || ''
        ).run();

        // ⚡ 背景非同步同步回 Google Sheets
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));

        return new Response("Success", {
          headers: { 'Content-Type': 'text/plain', ...corsHeaders }
        });
      }

      // ==========================================
      // [POST] updateRecord - 修改現有測量紀錄 (前端後台修改)
      // ==========================================
      if (action === 'updateRecord' && request.method === 'POST') {
        const bagNo = params.get('bagNo');
        if (!bagNo) return errorResponse("缺少裝袋序號", 400);

        await env.DB.prepare(`
          UPDATE records SET
            status = COALESCE(?, status),
            admin_note = COALESCE(?, admin_note),
            sz_long = COALESCE(?, sz_long),
            sz_short = COALESCE(?, sz_short),
            sz_op_long = COALESCE(?, sz_op_long),
            sz_op_short = COALESCE(?, sz_op_short),
            sz_vest = COALESCE(?, sz_vest),
            sz_jacket = COALESCE(?, sz_jacket),
            sz_ems_inner = COALESCE(?, sz_ems_inner),
            sz_tac_jacket = COALESCE(?, sz_tac_jacket),
            sz_pant = COALESCE(?, sz_pant),
            sz_belt = COALESCE(?, sz_belt),
            sz_cap = COALESCE(?, sz_cap),
            sz_shoe = COALESCE(?, sz_shoe)
          WHERE bag_no = ?
        `).bind(
          params.get('status'), params.get('adminNote'),
          params.get('sz_long'), params.get('sz_short'), params.get('sz_op_long'), params.get('sz_op_short'),
          params.get('sz_vest'), params.get('sz_jacket'), params.get('sz_ems_inner'), params.get('sz_tac_jacket'),
          params.get('sz_pant'), params.get('sz_belt'), params.get('sz_cap'), params.get('sz_shoe'),
          bagNo
        ).run();

        // ⚡ 背景非同步同步回 Google Sheets
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));

        return jsonResponse({ success: true });
      }

      // ==========================================
      // [POST] bulkUpdate - 批量狀態更新
      // ==========================================
      if (action === 'bulkUpdate' && request.method === 'POST') {
        const bagNosStr = params.get('bagNos') || "";
        const newStatus = params.get('status');
        const boxId = params.get('boxId');
        const trackingNo = params.get('trackingNo') || "";

        if (bagNosStr && newStatus) {
          const bagNos = bagNosStr.split(',');
          for (const bagNo of bagNos) {
            if (bagNo.trim()) {
              await env.DB.prepare("UPDATE records SET status = ? WHERE bag_no = ?")
                .bind(newStatus, bagNo.trim()).run();
            }
          }
        }

        if (boxId) {
          const now = new Date();
          const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
          let boxStatusVal = params.get('boxStatus') || newStatus || '尚未紀錄';
          
          await env.DB.prepare(`
            INSERT INTO box_status (box_id, status, tracking_no, last_update)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(box_id) DO UPDATE SET
              status = excluded.status,
              tracking_no = CASE WHEN excluded.tracking_no != '' THEN excluded.tracking_no ELSE tracking_no END,
              last_update = excluded.last_update
          `).bind(boxId, boxStatusVal, trackingNo, timeStr).run();
        }

        // ⚡ 背景非同步同步回 Google Sheets
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));

        return jsonResponse({ success: true });
      }

      // ==========================================
      // [POST] saveSettings - 儲存設定
      // ==========================================
      if (action === 'saveSettings' && request.method === 'POST') {
        const baseUrl = params.get('base_url') || "";
        const adminPwd = params.get('admin_pwd') || "";
        const labelConfig = params.get('label_config') || "";

        if (baseUrl) {
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('base_url', ?)")
            .bind(baseUrl).run();
        }
        if (adminPwd) {
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_pwd', ?)")
            .bind(adminPwd).run();
        }
        if (labelConfig) {
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('label_config', ?)")
            .bind(labelConfig).run();
        }

        // ⚡ 背景非同步同步回 Google Sheets
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));

        return jsonResponse({ status: "success", message: "設定已更新" });
      }

      // ==========================================
      // [POST] importRecords - 批次匯入測量紀錄
      // ==========================================
      if (action === 'importRecords' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const records = payload.records || [];
        
        if (records.length === 0) return jsonResponse({ success: true, count: 0 });
        
        const batchStmts = [];
        for (const r of records) {
          const sql = `
            INSERT INTO records (
              system_time, reg_date, agency, brigade, unit, person_id, bag_no, name, gender, age, job,
              source, filename, file_url, height, shoulder, chest, waist, hip, inseam, series,
              sz_long, sz_short, sz_op_long, sz_op_short, sz_vest, sz_jacket, sz_ems_inner, sz_tac_jacket,
              sz_pant, sz_belt, sz_cap, sz_shoe, status, note, admin_note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bag_no) DO UPDATE SET
              system_time = excluded.system_time,
              reg_date = excluded.reg_date,
              agency = excluded.agency,
              brigade = excluded.brigade,
              unit = excluded.unit,
              person_id = excluded.person_id,
              name = excluded.name,
              gender = excluded.gender,
              age = excluded.age,
              job = excluded.job,
              source = excluded.source,
              filename = excluded.filename,
              file_url = excluded.file_url,
              height = excluded.height,
              shoulder = excluded.shoulder,
              chest = excluded.chest,
              waist = excluded.waist,
              hip = excluded.hip,
              inseam = excluded.inseam,
              series = excluded.series,
              sz_long = excluded.sz_long,
              sz_short = excluded.sz_short,
              sz_op_long = excluded.sz_op_long,
              sz_op_short = excluded.sz_op_short,
              sz_vest = excluded.sz_vest,
              sz_jacket = excluded.sz_jacket,
              sz_ems_inner = excluded.sz_ems_inner,
              sz_tac_jacket = excluded.sz_tac_jacket,
              sz_pant = excluded.sz_pant,
              sz_belt = excluded.sz_belt,
              sz_cap = excluded.sz_cap,
              sz_shoe = excluded.sz_shoe,
              status = excluded.status,
              note = excluded.note,
              admin_note = excluded.admin_note
          `;
          const values = [
            r.system_time || r['系統建檔時間'] || null,
            r.reg_date || r['登記日期'] || '',
            r.agency || r['機關名稱'] || '',
            r.brigade || r['大隊/分類'] || '',
            r.unit || r['單位名稱'] || '',
            r.person_id || r['人員識別碼'] || '',
            r.bag_no || r['裝袋序號'] || '',
            r.name || r['姓名'] || '',
            r.gender || r['性別'] || '',
            parseInt(r.age || r['年齡'] || '0', 10),
            r.job || r['職稱'] || '',
            r.source || r['量測方式'] || r['量測方式/來源'] || '',
            r.filename || r['照片檔名'] || '',
            r.file_url || r['照片連結'] || '',
            parseFloat(r.height || r['身高'] || '0'),
            parseFloat(r.shoulder || r['肩寬'] || '0'),
            parseFloat(r.chest || r['胸圍'] || '0'),
            parseFloat(r.waist || r['腰圍'] || '0'),
            parseFloat(r.hip || r['臀圍'] || '0'),
            parseFloat(r.inseam || r['褲內長'] || '0'),
            r.series || r['配發系列'] || '',
            r.sz_long || r['長袖'] || r['戰術服長袖'] || r['長袖戰術服'] || r['戰術服(長袖)'] || '',
            r.sz_short || r['短袖'] || r['戰術服短袖'] || r['短袖戰術服'] || r['戰術服(短袖)'] || '',
            r.sz_op_long || r['長袖操作服'] || r['操作服長袖'] || '',
            r.sz_op_short || r['短袖操作服'] || r['操作服短袖'] || '',
            r.sz_vest || r['背心'] || r['戰術背心'] || r['救護背心'] || r['戰術/救護背心'] || r['戰術背心尺寸'] || '',
            r.sz_jacket || r['外套'] || r['救護外套'] || '',
            r.sz_ems_inner || r['救護外套內件'] || r['救護內件'] || r['外套內件'] || '',
            r.sz_tac_jacket || r['戰術外套'] || r['戰術外套尺寸'] || '',
            r.sz_pant || r['戰術褲'] || r['褲子'] || '',
            r.sz_belt || r['褲帶'] || r['腰帶'] || r['戰術腰帶'] || '',
            r.sz_cap || r['戰術帽'] || r['戰術帽尺寸'] || '',
            r.sz_shoe || r['消防靴'] || r['鞋子'] || '',
            r.status || r['狀態'] || '待確認',
            r.note || r['現場備註'] || '',
            r.admin_note || r['後台備註'] || ''
          ];
          batchStmts.push(env.DB.prepare(sql).bind(...values));
        }

        const batchChunkSize = 50;
        for (let i = 0; i < batchStmts.length; i += batchChunkSize) {
          const sub = batchStmts.slice(i, i + batchChunkSize);
          await env.DB.batch(sub);
        }
        
        return jsonResponse({ success: true, count: records.length });
      }

      // ==========================================
      // [POST] importBoxStatus - 批次匯入分隊箱狀態
      // ==========================================
      if (action === 'importBoxStatus' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const boxes = payload.boxes || [];
        
        if (boxes.length === 0) return jsonResponse({ success: true, count: 0 });
        
        const chunkSize = 20;
        for (let i = 0; i < boxes.length; i += chunkSize) {
          const chunk = boxes.slice(i, i + chunkSize);
          const placeholders = [];
          const values = [];
          for (const b of chunk) {
            placeholders.push("(?, ?, ?, ?)");
            values.push(
              b.box_id || b['箱號'] || '',
              b.status || b['狀態'] || '',
              b.tracking_no || b['貨運單號'] || '',
              b.last_update || b['最後更新時間'] || ''
            );
          }
          const sql = `
            INSERT INTO box_status (box_id, status, tracking_no, last_update)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT(box_id) DO UPDATE SET
              status = excluded.status,
              tracking_no = excluded.tracking_no,
              last_update = excluded.last_update
          `;
          await env.DB.prepare(sql).bind(...values).run();
        }
        
        return jsonResponse({ success: true, count: boxes.length });
      }

      // ==========================================
      // [POST] importUnits - 批次匯入單位資料
      // ==========================================
      if (action === 'importUnits' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const units = payload.units || [];
        const isIncremental = payload.incremental === true;

        if (!isIncremental) {
          await env.DB.prepare("DELETE FROM units").run();
        }

        if (units.length > 0) {
          const chunkSize = 20;
          for (let i = 0; i < units.length; i += chunkSize) {
            const chunk = units.slice(i, i + chunkSize);
            const placeholders = [];
            const values = [];
            for (const u of chunk) {
              placeholders.push("(?, ?, ?, ?)");
              values.push(
                u['機關名稱'] || u.agency || '',
                u['所屬大隊/分類'] || u.brigade || '',
                u['單位名稱'] || u.unit || '',
                u['系統代碼'] || u.sys_code || ''
              );
            }
            const sql = `INSERT OR REPLACE INTO units (agency, brigade, unit, sys_code) VALUES ${placeholders.join(', ')}`;
            await env.DB.prepare(sql).bind(...values).run();
          }
        }
        return jsonResponse({ success: true, count: units.length });
      }

      // ==========================================
      // [POST] importRoster - 批次匯入人員名冊
      // ==========================================
      if (action === 'importRoster' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const roster = payload.roster || [];
        const isIncremental = payload.incremental === true;

        if (!isIncremental) {
          await env.DB.prepare("DELETE FROM roster").run();
        }

        if (roster.length > 0) {
          const chunkSize = 10;
          for (let i = 0; i < roster.length; i += chunkSize) {
            const chunk = roster.slice(i, i + chunkSize);
            const placeholders = [];
            const values = [];
            for (const p of chunk) {
              placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?)");
              values.push(
                p['機關名稱'] || p.agency || '',
                p['大隊'] || p['所屬大隊/分類'] || p.brigade || '',
                p['分隊'] || p['單位名稱'] || p.unit || '',
                p['姓名'] || p.name || '',
                p['性別'] || p.gender || '',
                p['人員識別碼'] || p.person_id || '',
                parseInt(p['年齡'] || p.age || '0', 10),
                p['職稱'] || p.job || ''
              );
            }
            const sql = `INSERT OR REPLACE INTO roster (agency, brigade, unit, name, gender, person_id, age, job) VALUES ${placeholders.join(', ')}`;
            await env.DB.prepare(sql).bind(...values).run();
          }
        }
        return jsonResponse({ success: true, count: roster.length });
      }

      // ==========================================
      // [POST] importJobs - 批次匯入職稱表
      // ==========================================
      if (action === 'importJobs' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const jobs = payload.jobs || [];

        await env.DB.prepare("DELETE FROM jobs").run();

        if (jobs.length > 0) {
          const chunkSize = 80;
          for (let i = 0; i < jobs.length; i += chunkSize) {
            const chunk = jobs.slice(i, i + chunkSize);
            const placeholders = [];
            const values = [];
            for (const j of chunk) {
              if (j) {
                placeholders.push("(?)");
                values.push(j.trim());
              }
            }
            if (values.length > 0) {
              const sql = `INSERT OR IGNORE INTO jobs (job) VALUES ${placeholders.join(', ')}`;
              await env.DB.prepare(sql).bind(...values).run();
            }
          }
        }
        return jsonResponse({ success: true, count: jobs.length });
      }

      // ==========================================
      // [POST] importClothingSizes - 批次匯入服裝尺碼選項
      // ==========================================
      if (action === 'importClothingSizes' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const sizes = payload.sizes || [];

        await env.DB.prepare("DELETE FROM clothing_sizes").run();

        if (sizes.length > 0) {
          const chunkSize = 40;
          for (let i = 0; i < sizes.length; i += chunkSize) {
            const chunk = sizes.slice(i, i + chunkSize);
            const placeholders = [];
            const values = [];
            for (const s of chunk) {
              placeholders.push("(?, ?)");
              values.push(
                s.item_name || s['服裝品項'] || s['品項'] || '',
                s.size_value || s['尺碼'] || s['尺寸'] || ''
              );
            }
            const sql = `INSERT OR IGNORE INTO clothing_sizes (item_name, size_value) VALUES ${placeholders.join(', ')}`;
            await env.DB.prepare(sql).bind(...values).run();
          }
        }
        return jsonResponse({ success: true, count: sizes.length });
      }

      // ==========================================
      // [POST] importSizesConfig - 批次匯入尺寸對照參數 JSON
      // ==========================================
      if (action === 'importSizesConfig' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const config = payload.config || {};
        
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sizes_config', ?)")
          .bind(JSON.stringify(config)).run();
          
        return jsonResponse({ success: true });
      }

      // ==========================================
      // [GET] getExistingBagNos - 獲取 D1 所有既存袋號
      // ==========================================
      if (action === 'getExistingBagNos') {
        const result = await env.DB.prepare("SELECT bag_no FROM records").all();
        const bagNos = (result.results || []).map(r => r.bag_no);
        return jsonResponse(bagNos);
      }

      // ==========================================
      // [POST] deleteRecords - 批次刪除紀錄
      // ==========================================
      if (action === 'deleteRecords' && request.method === 'POST') {
        const payload = JSON.parse(bodyText);
        const bagNos = payload.bagNos || [];
        
        if (bagNos.length === 0) return jsonResponse({ success: true, count: 0 });
        
        const stmt = env.DB.prepare("DELETE FROM records WHERE bag_no = ?");
        const statements = bagNos.map(b => stmt.bind(b));
        
        await env.DB.batch(statements);
        return jsonResponse({ success: true, count: bagNos.length });
      }

      // ==========================================
      // [POST] updateSizesConfig - 修改尺寸對照參數
      // ==========================================
      if (action === 'updateSizesConfig' && request.method === 'POST') {
        let payloadObj = null;
        try {
          payloadObj = JSON.parse(params.get('payload'));
        } catch(e) {}

        if (payloadObj && payloadObj.data) {
          const pwd = payloadObj.password;
          await verifyAdminPassword(env, pwd);

          // 同步寫入 D1 settings
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sizes_config', ?)")
            .bind(JSON.stringify(payloadObj.data)).run();
        }

        // 同時背景轉發給 GAS
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));
        return jsonResponse({ success: true, status: "success" });
      }

      // ==========================================
      // [POST] appendUnits 或其他轉發至 GAS
      // ==========================================
      if (request.method === 'POST') {
        ctx.waitUntil(syncToGoogleSheets(env, bodyText));
        return jsonResponse({ success: true, status: "success", message: "動作已轉發至 Google Sheets" });
      }

      return new Response("Not Found", { status: 404 });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, status: "error" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// ==========================================
//  🌟 輔助函式庫
// ==========================================

async function verifyAdminPassword(env, inputPassword) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_pwd'").first();
  const correctPassword = row ? row.value : 'admin123';
  if (inputPassword !== correctPassword) {
    throw new Error("密碼錯誤");
  }
}

async function getAllSettings(env) {
  const result = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  (result.results || []).forEach(r => {
    settings[r.key] = r.value;
  });
  // 預設密碼補全
  if (!settings.admin_pwd) settings.admin_pwd = 'admin123';
  return settings;
}

function formatRecordSizes(r) {
  if (!r) return null;
  return {
    "系統建檔時間": r.system_time,
    "登記日期": r.reg_date,
    "機關名稱": r.agency,
    "大隊/分類": r.brigade,
    "單位名稱": r.unit,
    "人員識別碼": r.person_id,
    "裝袋序號": r.bag_no,
    "姓名": r.name,
    "性別": r.gender,
    "年齡": r.age,
    "職稱": r.job,
    "量測方式": r.source,
    "照片檔名": r.filename,
    "照片連結": r.file_url,
    "身高": r.height,
    "肩寬": r.shoulder,
    "胸圍": r.chest,
    "腰圍": r.waist,
    "臀圍": r.hip,
    "褲內長": r.inseam,
    "配發系列": r.series,
    "長袖": r.sz_long,
    "戰術服長袖": r.sz_long,
    "短袖": r.sz_short,
    "戰術服短袖": r.sz_short,
    "長袖操作服": r.sz_op_long,
    "短袖操作服": r.sz_op_short,
    "背心": r.sz_vest,
    "戰術背心": r.sz_vest,
    "救護背心": r.sz_vest,
    "外套": r.sz_jacket,
    "救護外套": r.sz_jacket,
    "救護外套內件": r.sz_ems_inner,
    "戰術外套": r.sz_tac_jacket,
    "戰術褲": r.sz_pant,
    "褲帶": r.sz_belt,
    "戰術帽": r.sz_cap,
    "消防靴": r.sz_shoe,
    "狀態": r.status,
    "現場備註": r.note,
    "後台備註": r.admin_note,
    sizes: {
      'TL': r.sz_long, 'OPL': r.sz_op_long,
      'TS': r.sz_short, 'OPS': r.sz_op_short,
      'TV': r.sz_vest, 'EV': r.sz_vest,
      'EJ': r.sz_jacket, 'TP': r.sz_pant,
      'BELT': r.sz_belt, 'CAP': r.sz_cap, 'SHOE': r.sz_shoe,
      'TJ': r.sz_tac_jacket, 'EJI': r.sz_ems_inner
    }
  };
}

function formatBoxStatuses(rows) {
  const boxStatuses = {};
  const boxTrackingNos = {};
  const boxUpdateTimes = {};
  
  rows.forEach(r => {
    if (r.box_id) {
      boxStatuses[r.box_id] = r.status || '';
      boxTrackingNos[r.box_id] = r.tracking_no || '';
      boxUpdateTimes[r.box_id] = r.last_update || '';
    }
  });

  return { boxStatuses, boxTrackingNos, boxUpdateTimes };
}

// 獲取 GAS 單位資料 (快取)
async function getStaticUnitsFromGAS(env, ctx) {
  const now = Date.now();
  if (staticUnitsCache && (now - staticUnitsCacheTime < CACHE_DURATION)) {
    return staticUnitsCache;
  }

  const gasUrl = env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbweXBbTFXG6zn5pvaAWb5BNuILZ02gjCQ8nVEA8__HgxLtV6jzDBfIrVnp1OElBxf5y/exec"; 

  try {
    const res = await fetch(`${gasUrl}?action=getUnits`);
    const data = await res.json();
    if (data && !data.error) {
      staticUnitsCache = data;
      staticUnitsCacheTime = now;
      return data;
    }
  } catch (err) {
    console.error("無法連線至 GAS 獲取單位資料:", err);
  }

  return staticUnitsCache || { hierarchy: {}, systemCodes: {}, roster: [], jobs: [] };
}

// 獲取 GAS 尺寸配置資料 (快取)
async function getStaticSizesFromGAS(env, ctx) {
  const now = Date.now();
  if (staticSizesCache && (now - staticSizesCacheTime < CACHE_DURATION)) {
    return staticSizesCache;
  }

  const gasUrl = env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbweXBbTFXG6zn5pvaAWb5BNuILZ02gjCQ8nVEA8__HgxLtV6jzDBfIrVnp1OElBxf5y/exec"; 

  try {
    const res = await fetch(`${gasUrl}?action=getSizesConfig`);
    const data = await res.json();
    if (data && data.status === "success") {
      staticSizesCache = data.data;
      staticSizesCacheTime = now;
      return data.data;
    }
  } catch (err) {
    console.error("無法連線至 GAS 獲取尺寸配置:", err);
  }

  return staticSizesCache || {};
}

// 同步回寫 Google Sheets
async function syncToGoogleSheets(env, bodyText) {
  const gasUrl = env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbweXBbTFXG6zn5pvaAWb5BNuILZ02gjCQ8nVEA8__HgxLtV6jzDBfIrVnp1OElBxf5y/exec";
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyText
    });
    const text = await res.text();
    console.log("GAS 同步成功:", text);
  } catch (err) {
    console.error("GAS 同步失敗:", err);
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message, status: status }), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
