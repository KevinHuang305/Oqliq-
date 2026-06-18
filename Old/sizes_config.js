// 尺寸推薦演算法設定檔 (V1.2 版)
// 可依據需求隨時動態調整以下數值

window.SIZE_CONFIG = {
    // ----------------------------------------
    // 上衣類 (戰術上衣、操作服)
    // 演算法: MAX(胸圍尺寸, 腰圍尺寸)
    // ----------------------------------------
    top: {
        // 基本尺寸區間 (以最大值作為臨界)
        // XS≤87, S=88~93, M=94~99, L=100~105, XL=106~111, 2XL=112~117, 3XL≥118
        intervals: [
            { size: "XS", max: 87, value: 0 },
            { size: "S", max: 93, value: 1 },
            { size: "M", max: 99, value: 2 },
            { size: "L", max: 105, value: 3 },
            { size: "XL", max: 111, value: 4 },
            { size: "2XL", max: 117, value: 5 },
            { size: "3XL", max: Infinity, value: 6 }
        ],
        // 雙尺寸區間 (若數值落在區間內，輸出雙尺寸)
        // 92~93, 98~99, 104~105, 110~111, 116~117
        dualZones: [
            { min: 92, max: 93, output: "S/M" },
            { min: 98, max: 99, output: "M/L" },
            { min: 104, max: 105, output: "L/XL" },
            { min: 110, max: 111, output: "XL/2XL" },
            { min: 116, max: 117, output: "2XL/3XL" }
        ]
    },

    // ----------------------------------------
    // 外套類 (戰術夾克、救護外套內件、救護外套外件)
    // 演算法: MAX(胸圍尺寸, 腰圍尺寸)
    // ----------------------------------------
    jacket: {
        // XS≤91, S=92~97, M=98~103, L=104~109, XL=110~115, 2XL=116~121, 3XL≥122
        intervals: [
            { size: "XS", max: 91, value: 0 },
            { size: "S", max: 97, value: 1 },
            { size: "M", max: 103, value: 2 },
            { size: "L", max: 109, value: 3 },
            { size: "XL", max: 115, value: 4 },
            { size: "2XL", max: 121, value: 5 },
            { size: "3XL", max: Infinity, value: 6 }
        ],
        // 假設外套與上衣有相似的雙尺寸區邏輯 (區間最後2cm為交界)
        dualZones: [
            { min: 96, max: 97, output: "S/M" },
            { min: 102, max: 103, output: "M/L" },
            { min: 108, max: 109, output: "L/XL" },
            { min: 114, max: 115, output: "XL/2XL" },
            { min: 120, max: 121, output: "2XL/3XL" }
        ]
    },

    // ----------------------------------------
    // 背心類
    // ----------------------------------------
    vest: {
        emsMapping: {
            "XS": "S",
            "S": "S",
            "S/M": "S", // 假設雙尺寸也轉換
            "M": "M",
            "M/L": "L",
            "L": "L",
            "L/XL": "L",
            "XL": "XL",
            "XL/2XL": "XL",
            "2XL": "XL",
            "2XL/3XL": "XL",
            "3XL": "XL"
        }
    },

    // ----------------------------------------
    // 長褲類
    // 演算法: MAX(臀圍尺寸, 腰圍尺寸)
    // ----------------------------------------
    pants: {
        hipIntervals: [
            // ≤86=XS, 87~91=S, 92~96=M, 97~101=L, 102~106=XL, 107~111=2XL, ≥112=3XL
            { size: "XS", max: 86, value: 0 },
            { size: "S", max: 91, value: 1 },
            { size: "M", max: 96, value: 2 },
            { size: "L", max: 101, value: 3 },
            { size: "XL", max: 106, value: 4 },
            { size: "2XL", max: 111, value: 5 },
            { size: "3XL", max: Infinity, value: 6 }
        ],
        waistIntervals: [
            // 66~74=XS, 72~80=S, 78~86=M, 84~92=L, 90~98=XL, 96~104=2XL, 102~110=3XL
            // 有重疊區，以區間起始值決定（例如 72 起為 S，78 起為 M）
            { size: "XS", max: 71, value: 0 },
            { size: "S", max: 77, value: 1 },
            { size: "M", max: 83, value: 2 },
            { size: "L", max: 89, value: 3 },
            { size: "XL", max: 95, value: 4 },
            { size: "2XL", max: 101, value: 5 },
            { size: "3XL", max: Infinity, value: 6 }
        ],
        sizesArray: ["XS", "S", "M", "L", "XL", "2XL", "3XL"]
    },

    // ----------------------------------------
    // 特殊訂製判斷標準
    // ----------------------------------------
    customRules: {
        sleeveMaxMod: 5,   // 袖長修改超過此值為特殊訂製
        pantMaxMod: 8,     // 褲長修改超過此值為特殊訂製
        waistOverChestSizeDiff: 2, // 腰圍尺寸 > 胸圍尺寸 2 碼以上
        hipOverWaistSizeDiff: 2    // 臀圍尺寸 > 腰圍尺寸 2 碼以上
    }
};
