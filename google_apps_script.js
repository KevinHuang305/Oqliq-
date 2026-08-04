// ==========================================
// 🌟 系統授權設定
// ==========================================
function setupAuth() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("✅ 授權成功！");
}

// ==========================================
// 🌟 雲端系統設定管理 (新增標籤設定儲存)
// ==========================================
function initSettingsSheet(ss) {
  var sheet = ss.getSheetByName("系統設定");
  if (!sheet) {
    sheet = ss.insertSheet("系統設定");
    sheet.appendRow(["設定項目", "設定值", "說明"]);
    sheet.appendRow(["base_url", "", "系統前端發佈網址 (用於產生QR Code)"]);
    sheet.appendRow(["admin_pwd", "admin123", "管理員密碼"]); // 預設密碼
    sheet.getRange("A1:C1").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function initBoxStatusSheet(ss) {
  var sheet = ss.getSheetByName("分隊箱狀態");
  if (!sheet) {
    sheet = ss.insertSheet("分隊箱狀態");
    sheet.appendRow(["箱號", "狀態", "貨運單號", "最後更新時間"]); 
    sheet.getRange("A1:D1").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function initJobSheet(ss) {
  var sheet = ss.getSheetByName("職稱");
  if (!sheet) {
    sheet = ss.insertSheet("職稱");
    sheet.appendRow(["職稱"]);
    var defaults = ["隊員", "小隊長", "分隊長", "科員", "組員", "股長", "組長", "中隊長", "副大隊長", "技士", "副中隊長", "科長", "技佐", "大隊長", "專員", "辦事員", "專門委員", "技正", "管理師", "主任", "副局長", "局長", "秘書", "主任秘書", "督察", "消防士", "副小隊長", "副分隊長"];
    for (var i = 0; i < defaults.length; i++) {
      sheet.appendRow([defaults[i]]);
    }
    sheet.getRange("A1").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSystemSettings(ss) {
  var sheet = initSettingsSheet(ss);
  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    settings[data[i][0]] = data[i][1];
  }
  return settings;
}

function getSystemSettingsCached(ss) {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get("system_settings");
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch(e) {}
  
  var settings = getSystemSettings(ss);
  try {
    cache.put("system_settings", JSON.stringify(settings), 600); // 快取 10 分鐘
  } catch(e) {}
  return settings;
}

function saveSystemSettings(ss, baseUrl, adminPwd, labelConfig) {
  var sheet = initSettingsSheet(ss);
  var data = sheet.getDataRange().getValues();
  
  var updatedBaseUrl = false;
  var updatedAdminPwd = false;
  var updatedLabelConfig = false;
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === "base_url") {
      sheet.getRange(i + 1, 2).setValue(baseUrl);
      updatedBaseUrl = true;
    } else if (data[i][0] === "admin_pwd" && adminPwd) {
      sheet.getRange(i + 1, 2).setValue(adminPwd);
      updatedAdminPwd = true;
    } else if (data[i][0] === "label_config" && labelConfig) {
      // ★ 儲存標籤列印設定
      sheet.getRange(i + 1, 2).setValue(labelConfig);
      updatedLabelConfig = true;
    }
  }
  
  if (!updatedBaseUrl) sheet.appendRow(["base_url", baseUrl, "系統前端發佈網址 (用於產生QR Code)"]);
  if (!updatedAdminPwd && adminPwd) sheet.appendRow(["admin_pwd", adminPwd, "管理員密碼"]);
  if (!updatedLabelConfig && labelConfig) sheet.appendRow(["label_config", labelConfig, "標籤列印版面設定"]);
  
  // 清除設定快取
  try {
    CacheService.getScriptCache().remove("system_settings");
  } catch(e) {}
}

// ==========================================
// 🌟 尺寸參數解析函數 (V1.2版)
// ==========================================
function getSizesConfigFromSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("尺寸參數");
  if (!sheet) {
    return { error: "找不到「尺寸參數」工作表" };
  }
  
  var data = sheet.getDataRange().getValues();
  var config = {
    top: { intervals: [], dualZones: [] },
    jacket: { intervals: [], dualZones: [] },
    pants: { hipIntervals: [], waistIntervals: [], sizesArray: ["XS", "S", "M", "L", "XL", "2XL", "3XL"] },
    vest: { emsMapping: {} },
    customRules: {}
  };
  
  // 第一行是標題，所以從 i=1 開始
  for (var i = 1; i < data.length; i++) {
    var cat = data[i][0];
    var key = data[i][1];
    var val = data[i][2];
    
    if (!cat) continue;
    
    var numVal = (val === "Infinity" || val === "∞") ? Infinity : Number(val);
    
    if (cat === "top") config.top.intervals.push({ size: key, max: numVal, value: config.top.intervals.length });
    else if (cat === "top_dual") config.top.dualZones.push({ min: numVal - 1, max: numVal, output: key });
    
    else if (cat === "jacket") config.jacket.intervals.push({ size: key, max: numVal, value: config.jacket.intervals.length });
    else if (cat === "jacket_dual") config.jacket.dualZones.push({ min: numVal - 1, max: numVal, output: key });
    
    else if (cat === "pant_hip") config.pants.hipIntervals.push({ size: key, max: numVal, value: config.pants.hipIntervals.length });
    else if (cat === "pant_waist") config.pants.waistIntervals.push({ size: key, max: numVal, value: config.pants.waistIntervals.length });
    
    else if (cat === "vest_ems") config.vest.emsMapping[key] = String(val);
    else if (cat === "custom") config.customRules[key] = Number(val);
  }
  
  return config;
}

// ★ 新增：儲存尺寸參數回試算表的函數
function updateSizesConfigToSheet(config) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("尺寸參數");
  if (!sheet) {
    sheet = ss.insertSheet("尺寸參數");
  }
  
  // 清空舊資料
  sheet.clear();
  
  // 準備寫入的新行，第一行為標題
  var rows = [["分類 (cat)", "項目/尺碼 (key)", "數值上限 (val)"]]; 
  
  function pushIntervals(catPrefix, intervals) {
    if (!intervals) return;
    intervals.forEach(function(r) {
      var maxVal = (r.max === null || r.max === "Infinity") ? "Infinity" : r.max;
      rows.push([catPrefix, r.size, maxVal]);
    });
  }
  
  function pushDualZones(catPrefix, dualZones) {
    if (!dualZones) return;
    dualZones.forEach(function(dz) {
      rows.push([catPrefix, dz.output, dz.max]);
    });
  }
  
  if (config.top) {
    pushIntervals("top", config.top.intervals);
    pushDualZones("top_dual", config.top.dualZones);
  }
  
  if (config.jacket) {
    pushIntervals("jacket", config.jacket.intervals);
    pushDualZones("jacket_dual", config.jacket.dualZones);
  }
  
  if (config.pants) {
    pushIntervals("pant_hip", config.pants.hipIntervals);
    pushIntervals("pant_waist", config.pants.waistIntervals);
  }
  
  if (config.vest && config.vest.emsMapping) {
    for (var k in config.vest.emsMapping) {
      rows.push(["vest_ems", k, config.vest.emsMapping[k]]);
    }
  }
  
  if (config.customRules) {
    for (var key in config.customRules) {
      rows.push(["custom", key, config.customRules[key]]);
    }
  }
  
  // 寫入試算表
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
}

// ==========================================
// 🌟 處理 GET 請求
// ==========================================
function doGet(e) {
  var action = e.parameter.action || "getUnits";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === "getSettings") {
    var settings = getSystemSettingsCached(ss);
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: settings
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // ★ 獲取動態尺寸配置 API
  else if (action === "getSizesConfig") {
    var config = getSizesConfigFromSheet();
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: config
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  else if (action === "getUnits") {
    var sheet = ss.getSheetByName("單位資料");
    var rosterSheet = ss.getSheetByName("人員名冊");
    var measureSheet = ss.getSheetByName("測量紀錄"); 
    
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({"error": "找不到『單位資料』工作表"})).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    
    // ★ 動態獲取職稱清單
    var jobSheet = initJobSheet(ss);
    var jobs = [];
    if (jobSheet) {
      var jobData = jobSheet.getDataRange().getValues();
      var startRow = (jobData.length > 0 && (jobData[0][0] === "職稱" || jobData[0][0] === "項目")) ? 1 : 0;
      for (var j = startRow; j < jobData.length; j++) {
        var val = jobData[j][0];
        if (val && val.toString().trim() !== "") {
          jobs.push(val.toString().trim());
        }
      }
    }
    
    var result = { hierarchy: {}, systemCodes: {}, roster: [], measured: [], jobs: jobs }; 

    
    for (var i = 1; i < data.length; i++) {
      var agency = data[i][0], brigade = data[i][1], unit = data[i][2], sysCode = data[i][3];
      if (agency && brigade && unit) {
        if (!result.hierarchy[agency]) result.hierarchy[agency] = {};
        if (!result.hierarchy[agency][brigade]) result.hierarchy[agency][brigade] =[];
        if (result.hierarchy[agency][brigade].indexOf(unit) === -1) result.hierarchy[agency][brigade].push(unit);
        result.systemCodes[agency + "_" + brigade + "_" + unit] = sysCode;
      }
    }

    if (rosterSheet) {
      var rosterData = rosterSheet.getDataRange().getValues();
      if (rosterData.length > 1) {
        var headers = rosterData[0];
        for (var r = 1; r < rosterData.length; r++) {
          var person = {};
          for (var c = 0; c < headers.length; c++) {
            person[headers[c]] = rosterData[r][c];
          }
          result.roster.push(person);
        }
      }
    }
    
    var existingIds = [];
    if (measureSheet) {
       var mData = measureSheet.getDataRange().getValues();
       if (mData.length > 1) {
         var mHeaders = mData[0];
         var nameIdx = mHeaders.indexOf("姓名");
         var agencyIdx = mHeaders.indexOf("機關名稱");
         var brigadeIdx = mHeaders.indexOf("大隊/分類");
         var unitIdx = mHeaders.indexOf("單位名稱");
         var personIdIdx = mHeaders.indexOf("人員識別碼");
         var bagNoIdx = mHeaders.indexOf("裝袋序號");
         
         for (var i = 1; i < mData.length; i++) {
            if (nameIdx > -1 && agencyIdx > -1 && brigadeIdx > -1 && unitIdx > -1) {
               var n = mData[i][nameIdx];
               var a = mData[i][agencyIdx];
               var b = mData[i][brigadeIdx];
               var u = mData[i][unitIdx];
               result.measured.push(a + "_" + b + "_" + u + "_" + n);
            }
            if (personIdIdx > -1) {
               var pId = mData[i][personIdIdx];
               if (pId && pId.toString().trim() !== "" && existingIds.indexOf(pId) === -1) {
                  existingIds.push(pId.toString().trim());
               }
            }
            if (bagNoIdx > -1) {
               var bgNo = mData[i][bagNoIdx];
               if (bgNo && bgNo.toString().trim() !== "" && existingIds.indexOf(bgNo) === -1) {
                  existingIds.push(bgNo.toString().trim());
               }
            }
         }
       }
    }
    result.existingIds = existingIds;
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  
  else if (action === "getRecordByBagNo") {
    var pwd = e.parameter.password;
    var settings = getSystemSettingsCached(ss);
    var currentAdminPwd = settings["admin_pwd"] || "admin123"; 
    if (pwd !== currentAdminPwd) return ContentService.createTextOutput(JSON.stringify({"error": "密碼錯誤"})).setMimeType(ContentService.MimeType.JSON);
    
    var bagNo = e.parameter.bagNo;
    if (!bagNo) return ContentService.createTextOutput(JSON.stringify({"error": "缺少裝袋序號"})).setMimeType(ContentService.MimeType.JSON);
    
    var sheet = ss.getSheetByName("測量紀錄");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({"error": "找不到測量紀錄"})).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return ContentService.createTextOutput(JSON.stringify({"error": "無資料"})).setMimeType(ContentService.MimeType.JSON);
    
    var headers = data[0];
    var rowIndex = -1;
    var colBagNo = headers.indexOf("裝袋序號");
    if (colBagNo !== -1 && sheet.getLastRow() > 1) {
      var range = sheet.getRange(2, colBagNo + 1, sheet.getLastRow() - 1, 1);
      var finder = range.createTextFinder(String(bagNo)).matchEntireCell(true);
      var resultCell = finder.findNext();
      if (resultCell) {
        rowIndex = resultCell.getRow();
      }
    }
    
    // Fallback: search row by row if finder failed
    if (rowIndex === -1) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colBagNo]).trim() === String(bagNo).trim()) {
          rowIndex = i + 1;
          break;
        }
      }
    }
    
    if (rowIndex === -1) {
      return ContentService.createTextOutput(JSON.stringify({"error": "找不到該筆資料"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = rowValues[j];
    }
    obj.sizes = {
      'TL': obj['長袖'], 'OPL': obj['長袖操作服'],
      'TS': obj['短袖'], 'OPS': obj['短袖操作服'],
      'TV': obj['背心'], 'EV': obj['背心'],
      'EJ': obj['外套'], 'TP': obj['戰術褲'],
      'BELT': obj['褲帶'], 'CAP': obj['戰術帽'], 'SHOE': obj['消防靴'],
      'TJ': obj['戰術外套'], 'EJI': obj['救護外套內件'] 
    };
    
    var boxSheet = initBoxStatusSheet(ss);
    var boxStatuses = {};
    var boxTrackingNos = {}; 
    var boxUpdateTimes = {}; 
    
    if (boxSheet) {
      var boxData = boxSheet.getDataRange().getValues();
      for (var k = 1; k < boxData.length; k++) {
        var bId = boxData[k][0];
        if (bId) {
          boxStatuses[bId] = boxData[k][1];
          if (boxData[k][2]) boxTrackingNos[bId] = boxData[k][2].toString();
          if (boxData[k][3]) boxUpdateTimes[bId] = boxData[k][3].toString();
        }
      }
    }

    var sizeSheet = ss.getSheetByName("服裝尺碼");
    var clothingSizes = {}; 
    if (sizeSheet) {
      var sizeData = sizeSheet.getDataRange().getValues();
      for (var s = 1; s < sizeData.length; s++) {
        var itemName = sizeData[s][2]; 
        var sizeValue = sizeData[s][4]; 
        if (itemName && sizeValue) {
          if (!clothingSizes[itemName]) clothingSizes[itemName] = [];
          if (clothingSizes[itemName].indexOf(sizeValue) === -1) {
            clothingSizes[itemName].push(sizeValue);
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      record: obj,
      boxStatuses: boxStatuses,
      boxTrackingNos: boxTrackingNos, 
      boxUpdateTimes: boxUpdateTimes, 
      clothingSizes: clothingSizes 
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  else if (action === "getRecordsBySquad") {
    var pwd = e.parameter.password;
    var settings = getSystemSettingsCached(ss);
    var currentAdminPwd = settings["admin_pwd"] || "admin123";
    if (pwd !== currentAdminPwd) return ContentService.createTextOutput(JSON.stringify({"error": "密碼錯誤"})).setMimeType(ContentService.MimeType.JSON);
    
    var box = e.parameter.box;
    if (!box) return ContentService.createTextOutput(JSON.stringify({"error": "缺少箱號"})).setMimeType(ContentService.MimeType.JSON);
    
    var unitSheet = ss.getSheetByName("單位資料");
    var unitData = unitSheet ? unitSheet.getDataRange().getValues() : [];
    var matchingUnits = [];
    for (var u = 1; u < unitData.length; u++) {
      var agency = unitData[u][0], brigade = unitData[u][1], unitName = unitData[u][2], sysCode = unitData[u][3];
      if (sysCode === box || (agency + "_" + brigade + "_" + unitName) === box) {
        matchingUnits.push(agency + "_" + brigade + "_" + unitName);
      }
    }
    
    var sheet = ss.getSheetByName("測量紀錄");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var headers = data[0];
    var records = [];
    var agencyIdx = headers.indexOf("機關名稱");
    var brigadeIdx = headers.indexOf("大隊/分類");
    var unitIdx = headers.indexOf("單位名稱");
    
    for (var i = 1; i < data.length; i++) {
      var a = data[i][agencyIdx];
      var b = data[i][brigadeIdx];
      var un = data[i][unitIdx];
      var key = a + "_" + b + "_" + un;
      if (matchingUnits.indexOf(key) !== -1 || key === box) {
        var obj = {};
        for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
        obj.sizes = {
          'TL': obj['長袖'], 'OPL': obj['長袖操作服'],
          'TS': obj['短袖'], 'OPS': obj['短袖操作服'],
          'TV': obj['背心'], 'EV': obj['背心'],
          'EJ': obj['外套'], 'TP': obj['戰術褲'],
          'BELT': obj['褲帶'], 'CAP': obj['戰術帽'], 'SHOE': obj['消防靴'],
          'TJ': obj['戰術外套'], 'EJI': obj['救護外套內件'] 
        };
        records.push(obj);
      }
    }
    
    var boxSheet = initBoxStatusSheet(ss);
    var boxStatuses = {};
    var boxTrackingNos = {}; 
    var boxUpdateTimes = {}; 
    
    if (boxSheet) {
      var boxData = boxSheet.getDataRange().getValues();
      for (var k = 1; k < boxData.length; k++) {
        var bId = boxData[k][0];
        if (bId && (bId === box || bId.indexOf(box) === 0)) {
          boxStatuses[bId] = boxData[k][1];
          if (boxData[k][2]) boxTrackingNos[bId] = boxData[k][2].toString();
          if (boxData[k][3]) boxUpdateTimes[bId] = boxData[k][3].toString();
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      records: records.reverse(),
      boxStatuses: boxStatuses,
      boxTrackingNos: boxTrackingNos, 
      boxUpdateTimes: boxUpdateTimes
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  else if (action === "getRecordsByUnit") {
    var pwd = e.parameter.password;
    var settings = getSystemSettingsCached(ss);
    var currentAdminPwd = settings["admin_pwd"] || "admin123";
    if (pwd !== currentAdminPwd) return ContentService.createTextOutput(JSON.stringify({"error": "密碼錯誤"})).setMimeType(ContentService.MimeType.JSON);
    
    var unitName = e.parameter.name;
    if (!unitName) return ContentService.createTextOutput(JSON.stringify({"error": "缺少機關名稱"})).setMimeType(ContentService.MimeType.JSON);
    
    var sheet = ss.getSheetByName("測量紀錄");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var headers = data[0];
    var records = [];
    var agencyIdx = headers.indexOf("機關名稱");
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][agencyIdx] === unitName) {
        var obj = {};
        for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
        obj.sizes = {
          'TL': obj['長袖'], 'OPL': obj['長袖操作服'],
          'TS': obj['短袖'], 'OPS': obj['短袖操作服'],
          'TV': obj['背心'], 'EV': obj['背心'],
          'EJ': obj['外套'], 'TP': obj['戰術褲'],
          'BELT': obj['褲帶'], 'CAP': obj['戰術帽'], 'SHOE': obj['消防靴'],
          'TJ': obj['戰術外套'], 'EJI': obj['救護外套內件'] 
        };
        records.push(obj);
      }
    }
    
    var boxSheet = initBoxStatusSheet(ss);
    var boxStatuses = {};
    var boxTrackingNos = {}; 
    var boxUpdateTimes = {}; 
    
    if (boxSheet) {
      var boxData = boxSheet.getDataRange().getValues();
      for (var k = 1; k < boxData.length; k++) {
        var bId = boxData[k][0];
        if (bId && (bId === unitName || bId.indexOf(unitName) === 0)) {
          boxStatuses[bId] = boxData[k][1];
          if (boxData[k][2]) boxTrackingNos[bId] = boxData[k][2].toString();
          if (boxData[k][3]) boxUpdateTimes[bId] = boxData[k][3].toString();
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      records: records.reverse(),
      boxStatuses: boxStatuses,
      boxTrackingNos: boxTrackingNos, 
      boxUpdateTimes: boxUpdateTimes
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  else if (action === "getRecords") {
    var pwd = e.parameter.password;
    
    var settings = getSystemSettingsCached(ss);
    var currentAdminPwd = settings["admin_pwd"] || "admin123"; 
    
    if (pwd !== currentAdminPwd) return ContentService.createTextOutput(JSON.stringify({"error": "密碼錯誤"})).setMimeType(ContentService.MimeType.JSON);
    
    var sheet = ss.getSheetByName("測量紀錄");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var data = sheet.getDataRange().getValues(); 
    if (data.length <= 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var headers = data[0];
    var records =[];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
      obj.sizes = {
        'TL': obj['長袖'], 'OPL': obj['長袖操作服'],
        'TS': obj['短袖'], 'OPS': obj['短袖操作服'],
        'TV': obj['背心'], 'EV': obj['背心'],
        'EJ': obj['外套'], 'TP': obj['戰術褲'],
        'BELT': obj['褲帶'], 'CAP': obj['戰術帽'], 'SHOE': obj['消防靴'],
        'TJ': obj['戰術外套'], 'EJI': obj['救護外套內件'] 
      };
      records.push(obj);
    }
    
    var boxSheet = initBoxStatusSheet(ss);
    var boxStatuses = {};
    var boxTrackingNos = {}; 
    var boxUpdateTimes = {}; 
    
    if (boxSheet) {
      var boxData = boxSheet.getDataRange().getValues();
      for (var k = 1; k < boxData.length; k++) {
        var bId = boxData[k][0];
        if (bId) {
          boxStatuses[bId] = boxData[k][1];
          if (boxData[k][2]) boxTrackingNos[bId] = boxData[k][2].toString();
          if (boxData[k][3]) boxUpdateTimes[bId] = boxData[k][3].toString();
        }
      }
    }

    var sizeSheet = ss.getSheetByName("服裝尺碼");
    var clothingSizes = {}; 
    
    if (sizeSheet) {
      var sizeData = sizeSheet.getDataRange().getValues();
      for (var s = 1; s < sizeData.length; s++) {
        var itemName = sizeData[s][2]; 
        var sizeValue = sizeData[s][4]; 
        
        if (itemName && sizeValue) {
          if (!clothingSizes[itemName]) {
            clothingSizes[itemName] = [];
          }
          if (clothingSizes[itemName].indexOf(sizeValue) === -1) {
            clothingSizes[itemName].push(sizeValue);
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      records: records.reverse(),
      boxStatuses: boxStatuses,
      boxTrackingNos: boxTrackingNos, 
      boxUpdateTimes: boxUpdateTimes, 
      clothingSizes: clothingSizes 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 🌟 處理 POST 請求
// ==========================================
function doPost(e) {
  if (!e || !e.parameter) return ContentService.createTextOutput("Error").setMimeType(ContentService.MimeType.TEXT);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ★ 處理透過 JSON payload 傳遞的修改尺碼表請求與單位更新
  if (e.parameter.payload) {
    try {
      var payloadObj = JSON.parse(e.parameter.payload);
      
      if (payloadObj.action === "updateSizesConfig") {
        var pwd = payloadObj.password;
        var settings = getSystemSettingsCached(ss);
        var currentAdminPwd = settings["admin_pwd"] || "admin123";
        
        if (pwd !== currentAdminPwd) {
          return ContentService.createTextOutput(JSON.stringify({status: "error", error: "密碼錯誤"})).setMimeType(ContentService.MimeType.JSON);
        }
        
        updateSizesConfigToSheet(payloadObj.data);
        return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
      }
      
      // ★ 接收從前端傳來的新增單位請求
      if (payloadObj.action === "appendUnits") {
        var unitSheet = ss.getSheetByName("單位資料");
        if (!unitSheet) {
          return ContentService.createTextOutput(JSON.stringify({error: "找不到『單位資料』工作表"})).setMimeType(ContentService.MimeType.JSON);
        }
        
        var newUnits = payloadObj.newUnits || [];
        if (newUnits.length > 0) {
          for (var i = 0; i < newUnits.length; i++) {
            var u = newUnits[i];
            unitSheet.appendRow([u['機關名稱'] || "", u['所屬大隊/分類'] || "", u['單位名稱'] || "", u['系統代碼'] || ""]);
          }
        }
        return ContentService.createTextOutput(JSON.stringify({success: true, added: newUnits.length})).setMimeType(ContentService.MimeType.JSON);
      }
      
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", error: "解析 Payload 失敗: " + err.toString()})).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (e.parameter.action === "saveSettings") {
    var baseUrl = e.parameter.base_url || "";
    var adminPwd = e.parameter.admin_pwd || ""; 
    var labelConfig = e.parameter.label_config || ""; // ★ 接收標籤列印設定
    
    saveSystemSettings(ss, baseUrl, adminPwd, labelConfig); // ★ 傳遞給儲存函式
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success", message: "設定已更新"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName("測量紀錄");
  if (!sheet) sheet = ss.insertSheet("測量紀錄");
  
  if (e.parameter.action === "updateRecord") {
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colBagNo = headers.indexOf("裝袋序號");
    var targetBagNo = e.parameter.bagNo;
    for (var i = 1; i < data.length; i++) {
      if (data[i][colBagNo] === targetBagNo) {
        if (e.parameter.status) sheet.getRange(i + 1, headers.indexOf("狀態") + 1).setValue(e.parameter.status);
        if (e.parameter.adminNote !== undefined) sheet.getRange(i + 1, headers.indexOf("後台備註") + 1).setValue(e.parameter.adminNote);
        if (e.parameter.sz_long) sheet.getRange(i + 1, headers.indexOf("長袖") + 1).setValue(e.parameter.sz_long);
        if (e.parameter.sz_short) sheet.getRange(i + 1, headers.indexOf("短袖") + 1).setValue(e.parameter.sz_short);
        if (e.parameter.sz_op_long) sheet.getRange(i + 1, headers.indexOf("長袖操作服") + 1).setValue(e.parameter.sz_op_long);
        if (e.parameter.sz_op_short) sheet.getRange(i + 1, headers.indexOf("短袖操作服") + 1).setValue(e.parameter.sz_op_short);
        if (e.parameter.sz_vest) sheet.getRange(i + 1, headers.indexOf("背心") + 1).setValue(e.parameter.sz_vest);
        if (e.parameter.sz_jacket) sheet.getRange(i + 1, headers.indexOf("外套") + 1).setValue(e.parameter.sz_jacket);
        if (e.parameter.sz_ems_inner) sheet.getRange(i + 1, headers.indexOf("救護外套內件") + 1).setValue(e.parameter.sz_ems_inner);
        if (e.parameter.sz_tac_jacket) sheet.getRange(i + 1, headers.indexOf("戰術外套") + 1).setValue(e.parameter.sz_tac_jacket);
        if (e.parameter.sz_pant) sheet.getRange(i + 1, headers.indexOf("戰術褲") + 1).setValue(e.parameter.sz_pant);
        if (e.parameter.sz_belt) sheet.getRange(i + 1, headers.indexOf("褲帶") + 1).setValue(e.parameter.sz_belt);
        if (e.parameter.sz_cap) sheet.getRange(i + 1, headers.indexOf("戰術帽") + 1).setValue(e.parameter.sz_cap);
        if (e.parameter.sz_shoe) sheet.getRange(i + 1, headers.indexOf("消防靴") + 1).setValue(e.parameter.sz_shoe);
        return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({error: "找不到該筆資料"})).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (e.parameter.action === "bulkUpdate") {
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colBagNo = headers.indexOf("裝袋序號");
    var colStatus = headers.indexOf("狀態");
    
    var bagNos = (e.parameter.bagNos || "").split(",");
    var newStatus = e.parameter.status;
    var updatedCount = 0;
    
    if (bagNos.length > 0 && newStatus) {
      for (var i = 1; i < data.length; i++) {
        if (bagNos.indexOf(data[i][colBagNo].toString()) !== -1) {
          sheet.getRange(i + 1, colStatus + 1).setValue(newStatus);
          updatedCount++;
        }
      }
    }
    
    var boxId = e.parameter.boxId;
    var boxStatus = e.parameter.boxStatus || newStatus;
    var trackingNo = e.parameter.trackingNo || ""; 
    
    if (boxId) {
      var boxSheet = initBoxStatusSheet(ss);
      var boxData = boxSheet.getDataRange().getValues();
      var foundBox = false;
      
      var now = new Date();
      var timeStr = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate() + ' ' + now.getHours() + ':' + now.getMinutes();

      for (var j = 1; j < boxData.length; j++) {
        if (boxData[j][0] === boxId) {
          boxSheet.getRange(j + 1, 2).setValue(boxStatus);
          if (trackingNo !== "") boxSheet.getRange(j + 1, 3).setValue(trackingNo); 
          boxSheet.getRange(j + 1, 4).setValue(timeStr); 
          foundBox = true;
          break;
        }
      }
      if (!foundBox) {
        boxSheet.appendRow([boxId, boxStatus, trackingNo, timeStr]); 
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({success: true, updatedCount: updatedCount})).setMimeType(ContentService.MimeType.JSON);
  }
  
  // 增加"長袖操作服"與"短袖操作服"
  var headersList =["系統建檔時間", "登記日期", "機關名稱", "大隊/分類", "單位名稱", "人員識別碼", "裝袋序號", "姓名", "性別", "年齡", "職稱", "量測方式", "照片檔名", "照片連結", "身高", "肩寬", "胸圍", "腰圍", "臀圍", "褲內長", "配發系列", "長袖", "短袖", "長袖操作服", "短袖操作服", "背心", "外套", "救護外套內件", "戰術外套", "戰術褲", "褲帶", "戰術帽", "消防靴", "狀態", "現場備註", "後台備註"];
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headersList);
  }
  
  var regDate = e.parameter.regDate || "未提供";
  var agency = e.parameter.agency || "未提供", brigade = e.parameter.brigade || "未提供", unit = e.parameter.unit || "未提供";
  var personId = e.parameter.personId || "未提供", bagNo = e.parameter.bagNo || "未提供";
  var name = e.parameter.name || "未提供", gender = e.parameter.gender || "未提供", age = e.parameter.age || "未提供";
  var job = e.parameter.job || "未提供", source = e.parameter.source || "未提供", filename = e.parameter.filename || "無照片";
  var height = e.parameter.height || "", shoulder = e.parameter.shoulder || "", chest = e.parameter.chest || "";
  var waist = e.parameter.waist || "", hip = e.parameter.hip || "", inseam = e.parameter.inseam || "";
  var series = e.parameter.series || "";
  
  var sz_long = e.parameter.sz_long || "", sz_short = e.parameter.sz_short || "";
  var sz_op_long = e.parameter.sz_op_long || "", sz_op_short = e.parameter.sz_op_short || "";
  var sz_vest = e.parameter.sz_vest || "";
  
  var sz_jacket = e.parameter.sz_jacket || "", sz_pant = e.parameter.sz_pant || "", sz_belt = e.parameter.sz_belt || "";
  var sz_cap = e.parameter.sz_cap || "", sz_shoe = e.parameter.sz_shoe || "";
  var sz_ems_inner = e.parameter.sz_ems_inner || "";
  var sz_tac_jacket = e.parameter.sz_tac_jacket || "";
  
  var status = e.parameter.status || "待確認", note = e.parameter.note || "", adminNote = e.parameter.adminNote || "";
  
  var fileUrl = "無照片", fileData = e.parameter.fileData; 
  if (fileData && fileData !== "") {
    try {
      var base64String = fileData.split(",")[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(base64String), "image/jpeg", personId + "_" + name + ".jpg");
      var folderId = "1lUc1ElXP1LUjpQrDcUBDU9cG6ilgXwyk"; 
      var folder = DriveApp.getFolderById(folderId);
      var file = folder.createFile(blob);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
      fileUrl = file.getUrl();
    } catch(err) { fileUrl = "圖片上傳失敗: " + err.toString(); }
  }
  
  sheet.appendRow([new Date(), regDate, agency, brigade, unit, personId, bagNo, name, gender, age, job, source, filename, fileUrl, height, shoulder, chest, waist, hip, inseam, series, sz_long, sz_short, sz_op_long, sz_op_short, sz_vest, sz_jacket, sz_ems_inner, sz_tac_jacket, sz_pant, sz_belt, sz_cap, sz_shoe, status, note, adminNote]);
  
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}

// ==========================================
// 🌟 歷史資料批次同步至 Cloudflare D1
// ==========================================
function exportAllSheetsToD1() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfUrl = "https://firescue-cf-backend.donothing1030.workers.dev/api/";
  
  // 1. 同步「測量紀錄」
  var measureSheet = ss.getSheetByName("測量紀錄");
  if (measureSheet) {
    var data = measureSheet.getDataRange().getValues();
    if (data.length > 1) {
      var headers = data[0];
      var records = [];
      for (var i = 1; i < data.length; i++) {
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
          var val = data[i][j];
          if (val instanceof Date) {
            val = val.toISOString();
          }
          obj[headers[j]] = val;
        }
        records.push(obj);
      }
      
      // 每 100 筆為一個 chunk 分批發送，防範 payload 過大
      var chunk = 100;
      for (var k = 0; k < records.length; k += chunk) {
        var sub = records.slice(k, k + chunk);
        var options = {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ records: sub })
        };
        try {
          var res = UrlFetchApp.fetch(cfUrl + "importRecords", options);
          Logger.log("批次測量紀錄寫入成功: " + (k + sub.length) + "/" + records.length);
        } catch(err) {
          Logger.log("批次測量紀錄寫入失敗 (索引 " + k + "): " + err.toString());
        }
      }
      Logger.log("✅ 測量紀錄同步完成，共 " + records.length + " 筆。");
    }
  }
  
  // 2. 同步「分隊箱狀態」
  var boxSheet = ss.getSheetByName("分隊箱狀態");
  if (boxSheet) {
    var bData = boxSheet.getDataRange().getValues();
    if (bData.length > 1) {
      var bHeaders = bData[0];
      var boxes = [];
      for (var i = 1; i < bData.length; i++) {
        var bObj = {};
        for (var j = 0; j < bHeaders.length; j++) {
          var bVal = bData[i][j];
          if (bVal instanceof Date) {
            bVal = bVal.toISOString();
          }
          bObj[bHeaders[j]] = bVal;
        }
        boxes.push(bObj);
      }
      
      var bOptions = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ boxes: boxes })
      };
      try {
        UrlFetchApp.fetch(cfUrl + "importBoxStatus", bOptions);
        Logger.log("✅ 分隊箱狀態同步完成，共 " + boxes.length + " 筆。");
      } catch(err) {
        Logger.log("分隊箱狀態同步失敗: " + err.toString());
      }
    }
  }
}
