
        // ==========================================
        // 🌟 請將您的 Web App URL 貼在下方引號內 (請保留雙引號)
        // ==========================================
        const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbws9PMRaMg4-rQ0fwVKTXAGO6ePX0TjAoJdVaTpfgmdAxDvZMfK9zDPio9N824b6KqC/exec";
        // ==========================================

        import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

        let dbHierarchy = {}, dbSystemCodes = {};
        let allRecords = [], adminLoggedIn = false, savedAdminPwd = "";
        let currentRecordSizes = {};
        let labelQRCodes = [], currentLabelType = 'inner';

        // --- 漢堡選單切換 ---
        window.toggleMenu = function () {
            document.getElementById('navMenu').classList.toggle('show');
        };

        // --- 頁籤切換 ---
        window.switchTab = function (tab) {
            document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));

            if (event && event.target && event.target.classList.contains('nav-tab')) {
                event.target.classList.add('active');
            } else {
                document.querySelector(`.nav-tab[onclick*="${tab}"]`).classList.add('active');
            }

            document.getElementById('view-' + tab).classList.add('active');
            document.getElementById('navMenu').classList.remove('show');

            document.getElementById('loginOverlay').style.display = 'none';

            if ((tab === 'admin' || tab === 'labels') && !adminLoggedIn) {
                document.getElementById('loginOverlay').style.display = 'flex';
            } else if ((tab === 'admin' || tab === 'labels') && adminLoggedIn) {
                window.refreshAdminData(true).then(() => {
                    if (tab === 'labels') document.getElementById('btnLblInner').click();
                });
            }
        };

        document.getElementById('registerDate').value = new Date().toISOString().split('T')[0];

        // ==========================================
        //  1. 下拉選單連動
        // ==========================================
        async function loadDropdowns() {
            if (!APPS_SCRIPT_URL.startsWith("https://")) { document.getElementById('agencySelect').innerHTML = '<option value="">⚠️ 網址設定錯誤</option>'; return; }
            try {
                const url = APPS_SCRIPT_URL + (APPS_SCRIPT_URL.includes('?') ? '&' : '?') + 'action=getUnits';
                const res = await fetch(url);
                const textData = await res.text();
                let data; try { data = JSON.parse(textData); } catch (err) { throw new Error("API網址錯誤或未發佈新版本"); }
                if (data.error) throw new Error(data.error);

                dbHierarchy = data.hierarchy; dbSystemCodes = data.systemCodes;

                const agencySel = document.getElementById('agencySelect'), filterAgency = document.getElementById('filterAgency');
                agencySel.innerHTML = '<option value="">請選擇機關...</option>'; filterAgency.innerHTML = '<option value="">所有機關</option>';
                for (let agency in dbHierarchy) { agencySel.innerHTML += `<option value="${agency}">${agency}</option>`; filterAgency.innerHTML += `<option value="${agency}">${agency}</option>`; }
            } catch (e) { document.getElementById('agencySelect').innerHTML = `<option value="">⚠️ ${e.message}</option>`; }
        }

        document.getElementById('agencySelect').addEventListener('change', function () {
            const briSel = document.getElementById('brigadeSelect'), unitSel = document.getElementById('unitSelect');
            briSel.innerHTML = '<option value="">大隊/分類...</option>'; unitSel.innerHTML = '<option value="">單位名稱...</option>';
            unitSel.disabled = true; document.getElementById('personId').value = "";
            if (this.value && dbHierarchy[this.value]) {
                for (let brigade in dbHierarchy[this.value]) briSel.innerHTML += `<option value="${brigade}">${brigade}</option>`;
                briSel.disabled = false;
            } else { briSel.disabled = true; }
        });

        document.getElementById('brigadeSelect').addEventListener('change', function () {
            const unitSel = document.getElementById('unitSelect');
            unitSel.innerHTML = '<option value="">單位名稱...</option>'; document.getElementById('personId').value = "";
            const agency = document.getElementById('agencySelect').value;
            if (this.value && dbHierarchy[agency][this.value]) {
                dbHierarchy[agency][this.value].forEach(u => unitSel.innerHTML += `<option value="${u}">${u}</option>`);
                unitSel.disabled = false;
            } else { unitSelect.disabled = true; }
        });

        document.getElementById('unitSelect').addEventListener('change', function () {
            const agency = document.getElementById('agencySelect').value, brigade = document.getElementById('brigadeSelect').value;
            if (this.value) {
                const sysCode = dbSystemCodes[`${agency}_${brigade}_${this.value}`] || "SYS";
                const rnd = Math.floor(1000 + Math.random() * 9000);
                document.getElementById('personId').value = `${sysCode}-${rnd}`;
            } else { document.getElementById('personId').value = ""; }
        });

        loadDropdowns();

        // ==========================================
        //  2. 畫布與 AI 測量
        // ==========================================
        let poseLandmarker = null, uploadedFileName = "無正面照片", uploadedFileNameSide = "無側面照片";
        let isDrawing = false, startP = null, currentP = null, currentTool = null, pendingMeasureLine = null;
        const DRAG_RADIUS = 20; let hoveredPoint = null, draggingPoint = null;
        
        let currentView = 'front';
        const views = {
            front: { img: new Image(), refLine: null, measureLines: [], pxPerCm: 0 },
            side: { img: new Image(), refLine: null, measureLines: [], pxPerCm: 0 }
        };

        window.switchCanvasView = function (view) {
            currentView = view;
            document.getElementById('btnViewFront').className = view === 'front' ? 'view-tab active' : 'view-tab';
            document.getElementById('btnViewSide').className = view === 'side' ? 'view-tab active' : 'view-tab';
            document.getElementById('btnAiDetect').style.display = 'block';
            document.getElementById('btnToolRef').style.display = view === 'front' ? 'block' : 'none';
            
            if (views[view].img.src) {
                canvas.width = views[view].img.width;
                canvas.height = views[view].img.height;
                document.getElementById('btnCenterUpload').style.display = 'none';
                cStatus.innerText = view === 'front' ? "正面照片已載入" : "側面照片已載入，請手動拉線測量厚度";
            } else {
                canvas.width = 0;
                canvas.height = 0;
                document.getElementById('btnCenterUpload').style.display = 'flex';
                document.getElementById('btnCenterUpload').onclick = function() {
                    document.getElementById(view === 'front' ? 'imageUpload' : 'imageUploadSide').click();
                };
                cStatus.innerText = "等待載入照片...";
            }
            redraw();
        };
        const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d');
        const cStatus = document.getElementById('canvasStatus');

        window.setTool = function (tool) {
            if (currentTool === tool) {
                tool = null;
            }
            currentTool = tool;
            document.getElementById('btnToolRef').classList.toggle('active', tool === 'ref');
            document.getElementById('btnToolMeas').classList.toggle('active', tool === 'measure');
        };

        window.promptHeightAndSetRef = function () {
            if (currentTool === 'ref') {
                setTool('ref');
                return;
            }
            let defaultHeight = document.getElementById('refHeightInput').value || "175";
            let heightInput = prompt("請輸入被測量者的實際身高 (公分)，做為基準比例：", defaultHeight);
            if (heightInput === null || heightInput.trim() === "" || isNaN(parseFloat(heightInput))) {
                return;
            }
            document.getElementById('refHeightInput').value = parseFloat(heightInput);
            setTool('ref');
        };

        window.selectMeasurePart = function (labelName, inputId) {
            if (!pendingMeasureLine) return;

            let finalLabel = labelName;
            let multiplier = 1;

            if (labelName === '胸圍') multiplier = 2.6;
            else if (labelName === '腰圍') multiplier = 2.4;
            else if (labelName === '臀圍') multiplier = 2.2;

            let rawVal = parseFloat(pendingMeasureLine.val);
            let finalVal = (rawVal * multiplier).toFixed(1);

            if (multiplier !== 1) {
                finalLabel = `${labelName}(推估)`;
            }

            if (labelName === 'custom') {
                finalLabel = document.getElementById('customMeasurePart').value.trim();
                if (!finalLabel) finalLabel = "自訂線段";
            }

            // 精準計算已移至 redraw() 動態處理
            if (inputId) {
                document.getElementById(inputId).value = finalVal;
            }

            views[currentView].measureLines.push({
                p1: pendingMeasureLine.p1,
                p2: pendingMeasureLine.p2,
                name: finalLabel,
                val: finalVal,
                rawVal: rawVal,
                multiplier: multiplier,
                inputId: inputId,
                baseLabel: labelName
            });

            pendingMeasureLine = null;
            document.getElementById('measureModal').classList.remove('active');
            redraw();
        };

        window.cancelMeasurePart = function () {
            pendingMeasureLine = null;
            document.getElementById('measureModal').classList.remove('active');
            redraw();
        };

        async function initAI() {
            try {
                const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
                poseLandmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" }, runningMode: "IMAGE", numPoses: 1 });
                document.getElementById('btnAiDetect').disabled = false;
                cStatus.innerText = "系統就緒，請上傳照片";
            } catch (e) { cStatus.innerText = "AI 模型載入失敗"; }
        }
        initAI();

        document.getElementById('imageUpload').addEventListener('change', function (e) {
            if (!e.target.files[0]) return;
            uploadedFileName = e.target.files[0].name;
            document.getElementById('fileNameDisplay').innerText = uploadedFileName + (views.side.img.src ? " (已上傳雙面)" : "");
            document.getElementById('fileNameDisplay').style.borderColor = "var(--primary)";
            document.getElementById('fileNameDisplay').style.color = "var(--primary)";
            cStatus.innerText = "圖片載入中...";
            const reader = new FileReader();
            reader.onload = e => { 
                views.front.img.onload = function() {
                    if (currentView === 'front') {
                        canvas.width = views.front.img.width;
                        canvas.height = views.front.img.height;
                        window.resetCanvas();
                        cStatus.innerText = "正面照片已載入。可選擇上方工具開始測量。";
                        document.getElementById('btnCenterUpload').style.display = 'none';
                    }
                };
                views.front.img.src = e.target.result; 
            };
            reader.readAsDataURL(e.target.files[0]);
        });
        
        document.getElementById('imageUploadSide').addEventListener('change', function (e) {
            if (!e.target.files[0]) return;
            uploadedFileNameSide = e.target.files[0].name;
            document.getElementById('fileNameDisplay').innerText = (views.front.img.src ? uploadedFileName + " (已上傳雙面)" : uploadedFileNameSide + " (僅側面)");
            document.getElementById('fileNameDisplay').style.borderColor = "var(--primary)";
            document.getElementById('fileNameDisplay').style.color = "var(--primary)";
            cStatus.innerText = "圖片載入中...";
            const reader = new FileReader();
            reader.onload = e => { 
                views.side.img.onload = function() {
                    if (currentView === 'side') {
                        canvas.width = views.side.img.width;
                        canvas.height = views.side.img.height;
                        window.resetCanvas();
                        cStatus.innerText = "側面照片已載入。請手動拉線測量厚度。";
                        document.getElementById('btnCenterUpload').style.display = 'none';
                    }
                };
                views.side.img.src = e.target.result; 
            };
            reader.readAsDataURL(e.target.files[0]);
        });

        views.front.img.onload = function () {
            if (currentView === 'front') {
                canvas.width = views.front.img.width;
                canvas.height = views.front.img.height;
                window.resetCanvas();
                cStatus.innerText = "正面照片已載入。可選擇上方工具開始測量。";
                document.getElementById('btnCenterUpload').style.display = 'none';
            }
        };
        
        views.side.img.onload = function () {
            if (currentView === 'side') {
                canvas.width = views.side.img.width;
                canvas.height = views.side.img.height;
                window.resetCanvas();
                cStatus.innerText = "側面照片已載入。請手動拉線測量厚度。";
                document.getElementById('btnCenterUpload').style.display = 'none';
            }
        };

        window.resetCanvas = function () {
            views[currentView].refLine = null; views[currentView].measureLines = []; views[currentView].pxPerCm = 0; currentTool = null;
            document.getElementById('btnToolRef').classList.remove('active');
            document.getElementById('btnToolMeas').classList.remove('active');
            redraw();
        };

        function getCoords(e) {
            const rect = canvas.getBoundingClientRect();
            let cX = e.clientX || (e.touches ? e.touches[0].clientX : 0), cY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            return { x: (cX - rect.left) * (canvas.width / rect.width), y: (cY - rect.top) * (canvas.height / rect.height) };
        }
        function dist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }

        function getPointAt(p) {
            if (views[currentView].refLine) {
                if (dist(p, views[currentView].refLine.p1) < (DRAG_RADIUS * canvas.width / 500)) return { line: views[currentView].refLine, pt: 'p1' };
                if (dist(p, views[currentView].refLine.p2) < (DRAG_RADIUS * canvas.width / 500)) return { line: views[currentView].refLine, pt: 'p2' };
            }
            for (let l of views[currentView].measureLines) {
                if (dist(p, l.p1) < (DRAG_RADIUS * canvas.width / 500)) return { line: l, pt: 'p1' };
                if (dist(p, l.p2) < (DRAG_RADIUS * canvas.width / 500)) return { line: l, pt: 'p2' };
            }
            return null;
        }

        const downEvent = d => {
            if (!views[currentView].img.hasAttribute('src')) return;
            const p = getCoords(d);

            const hp = getPointAt(p);
            if (hp) {
                if (d.type === 'touchstart') d.preventDefault();
                draggingPoint = hp; isDrawing = false; return;
            }

            if (views[currentView].refLine && views[currentView].refLine.labelBox) {
                const lb = views[currentView].refLine.labelBox;
                if (p.x >= lb.x && p.x <= lb.x + lb.w && p.y >= lb.y && p.y <= lb.y + lb.h) {
                    if (d.type === 'touchstart') d.preventDefault();
                    let newVal = prompt(`修改 身高基準 (目前: ${views[currentView].refLine.real} cm):`, views[currentView].refLine.real);
                    if (newVal !== null && newVal.trim() !== "" && !isNaN(parseFloat(newVal))) {
                        const realH = parseFloat(newVal);
                        views[currentView].refLine.real = realH;
                        document.getElementById('refHeightInput').value = realH;
                        document.getElementById('val-height').value = realH;
                        views[currentView].pxPerCm = dist(views[currentView].refLine.p1, views[currentView].refLine.p2) / realH;
                        redraw();
                    }
                    return;
                }
            }

            for (let l of views[currentView].measureLines) {
                if (l.labelBox) {
                    const lb = l.labelBox;
                    if (p.x >= lb.x && p.x <= lb.x + lb.w && p.y >= lb.y && p.y <= lb.y + lb.h) {
                        if (d.type === 'touchstart') d.preventDefault();
                        let newVal = prompt(`修改 ${l.name} (目前: ${l.val} cm):`, l.val);
                        if (newVal !== null && newVal.trim() !== "" && !isNaN(parseFloat(newVal))) {
                            const finalVal = parseFloat(newVal);
                            const multi = l.multiplier || 1;
                            const targetDist = (finalVal / multi) * views[currentView].pxPerCm;
                            const currentDist = dist(l.p1, l.p2);
                            if (currentDist > 0) {
                                const ratio = targetDist / currentDist;
                                const cx = (l.p1.x + l.p2.x) / 2;
                                const cy = (l.p1.y + l.p2.y) / 2;
                                l.p1 = { x: cx + (l.p1.x - cx) * ratio, y: cy + (l.p1.y - cy) * ratio };
                                l.p2 = { x: cx + (l.p2.x - cx) * ratio, y: cy + (l.p2.y - cy) * ratio };
                            }
                            redraw();
                        }
                        return;
                    }
                }
            }
            if (!currentTool) return;
            if (currentTool === 'measure' && views[currentView].pxPerCm === 0) { alert("請先畫出身高基準線！"); setTool('ref'); return; }

            if (d.type === 'touchstart') d.preventDefault();
            isDrawing = true; startP = p; currentP = p;
        };
        canvas.addEventListener('mousedown', downEvent); canvas.addEventListener('touchstart', downEvent, { passive: false });

        const moveEvent = m => {
            const p = getCoords(m);

            if (draggingPoint) {
                if (m.type === 'touchmove') m.preventDefault();
                canvas.style.cursor = 'grabbing';
                draggingPoint.line[draggingPoint.pt] = p;
                if (draggingPoint.line === views[currentView].refLine) {
                    const otherPt = draggingPoint.pt === 'p1' ? 'p2' : 'p1';
                    draggingPoint.line[otherPt].x = p.x;
                    views[currentView].pxPerCm = dist(views[currentView].refLine.p1, views[currentView].refLine.p2) / views[currentView].refLine.real;
                    
                    if (currentView === 'side' && views.front.refLine && views.front.measureLines.length > 0) {
                        const frontRef = views.front.refLine;
                        const frontH = frontRef.p2.y - frontRef.p1.y;
                        if (frontH !== 0) {
                            views.side.measureLines.forEach(l => {
                                if (l.baseLabel) {
                                    const fl = views.front.measureLines.find(fl => fl.baseLabel === l.baseLabel);
                                    if (fl) {
                                        const ratioY = (fl.p1.y - frontRef.p1.y) / frontH;
                                        const newY = views.side.refLine.p1.y + ratioY * (views.side.refLine.p2.y - views.side.refLine.p1.y);
                                        l.p1.y = newY;
                                        l.p2.y = newY;
                                    }
                                }
                            });
                        }
                    }
                }
                redraw(); return;
            }

            if (!isDrawing) {
                hoveredPoint = getPointAt(p);
                canvas.style.cursor = hoveredPoint ? 'grab' : 'crosshair';
                redraw(); return;
            }

            if (m.type === 'touchmove') m.preventDefault();
            currentP = currentTool === 'ref' ? { x: startP.x, y: p.y } : p; 
            redraw();
            const color = currentTool === 'ref' ? '#ef4444' : '#60a5fa';
            let txt = currentTool === 'ref' ? '基準線' : (views[currentView].pxPerCm > 0 ? (dist(startP, currentP) / views[currentView].pxPerCm).toFixed(1) + 'cm' : '請先設基準');
            drawLine(startP, currentP, color, txt, currentTool === 'ref');
        };
        canvas.addEventListener('mousemove', moveEvent); canvas.addEventListener('touchmove', moveEvent, { passive: false });

        const upEvent = u => {
            if (draggingPoint) { draggingPoint = null; canvas.style.cursor = 'crosshair'; return; }
            if (!isDrawing) return; isDrawing = false;

            const d = dist(startP, currentP);
            if (d > (10 * canvas.width / 500)) {
                if (currentTool === 'ref') {
                    const realH = parseFloat(document.getElementById('refHeightInput').value);
                    views[currentView].refLine = { p1: startP, p2: currentP, real: realH };
                    views[currentView].pxPerCm = d / realH;
                    setTool('measure');
                    document.getElementById('val-height').value = realH;
                    cStatus.innerText = `基準已設定 (${realH}cm)。請繼續測量肩寬/胸圍。`;
                } else if (views[currentView].pxPerCm > 0) {
                    const val = (d / views[currentView].pxPerCm).toFixed(1);
                    pendingMeasureLine = { p1: startP, p2: currentP, val: val };
                    document.getElementById('measureResultText').innerText = val;
                    document.getElementById('customMeasurePart').value = "";

                    const existingParts = views[currentView].measureLines.map(l => l.name);
                    document.querySelectorAll('#measureModal .btn-outline').forEach(btn => {
                        const part = btn.innerText.split(' ')[0];
                        const exists = existingParts.some(ep => ep.startsWith(part));
                        btn.disabled = exists;
                        if (exists) {
                            btn.style.opacity = '0.4';
                            btn.style.cursor = 'not-allowed';
                            btn.innerText = part + " (已測量)";
                        } else {
                            btn.style.opacity = '1';
                            btn.style.cursor = 'pointer';
                            btn.innerText = part;
                        }
                    });

                    document.getElementById('measureModal').classList.add('active');
                }
            }
            redraw();
        };
        window.addEventListener('mouseup', upEvent); window.addEventListener('touchend', upEvent);

        function redraw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height); if (views[currentView].img.src) ctx.drawImage(views[currentView].img, 0, 0, canvas.width, canvas.height);

            if (views[currentView].refLine) views[currentView].refLine.labelBox = drawLine(views[currentView].refLine.p1, views[currentView].refLine.p2, '#ef4444', `身高基準: ${views[currentView].refLine.real}`, true);
            views[currentView].measureLines.forEach(l => {
                let multi = l.multiplier || 1;
                let rawVal = dist(l.p1, l.p2) / views[currentView].pxPerCm;
                l.rawVal = rawVal;
                let reVal = (rawVal * multi).toFixed(1);
                let finalName = l.baseLabel || l.name;
                let isPrecise = false;
                
                if (l.baseLabel && (l.baseLabel === '胸圍' || l.baseLabel === '腰圍' || l.baseLabel === '臀圍')) {
                    let otherView = currentView === 'front' ? 'side' : 'front';
                    let otherLine = views[otherView].measureLines.find(ol => ol.baseLabel === l.baseLabel);
                    if (otherLine && otherLine.rawVal) {
                        let a = currentView === 'front' ? rawVal : otherLine.rawVal;
                        let b = currentView === 'front' ? otherLine.rawVal : rawVal;
                        let perimeter = Math.PI * Math.sqrt(2 * (Math.pow(a/2, 2) + Math.pow(b/2, 2)));
                        reVal = perimeter.toFixed(1);
                        finalName = `${l.baseLabel}(精準)`;
                        isPrecise = true;
                    } else if (multi !== 1) {
                        finalName = `${l.baseLabel}(推估)`;
                    }
                }
                
                l.val = reVal;
                l.name = finalName;
                
                if (l.inputId) {
                    const inp = document.getElementById(l.inputId);
                    if (inp) {
                        inp.value = reVal;
                        if (isPrecise) {
                            inp.style.color = "#10b981";
                            inp.style.fontWeight = "bold";
                        } else {
                            inp.style.color = "";
                            inp.style.fontWeight = "normal";
                        }
                    }
                }
                l.labelBox = drawLine(l.p1, l.p2, isPrecise ? '#10b981' : '#60a5fa', `${finalName}: ${l.val}`);
            });

            if (hoveredPoint) {
                const hp = hoveredPoint.line[hoveredPoint.pt];
                const pointSize = 10 * (canvas.width / 800);
                ctx.beginPath(); ctx.arc(hp.x, hp.y, pointSize, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();
                ctx.strokeStyle = "#10b981"; ctx.lineWidth = 3; ctx.stroke();
            }

            // --- 放大鏡 (Loupe) 邏輯 ---
            if (draggingPoint || (isDrawing && currentP)) {
                let fX = draggingPoint ? draggingPoint.line[draggingPoint.pt].x : currentP.x;
                let fY = draggingPoint ? draggingPoint.line[draggingPoint.pt].y : currentP.y;
                
                const r = 50; 
                const zoom = 2;
                
                let cx = fX - r - 20;
                let cy = fY - r - 40;
                
                if (cy - r < 0) cy = fY + r + 40;
                if (cx - r < 0) cx = fX + r + 20;
                if (cx + r > canvas.width) cx = canvas.width - r - 10;
                
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#fff';
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 10;
                ctx.stroke();
                
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.clip();
                
                ctx.fillStyle = '#fff';
                ctx.fill();
                
                ctx.translate(cx, cy);
                ctx.scale(zoom, zoom);
                ctx.translate(-fX, -fY);
                if (views[currentView].img.src) {
                    ctx.drawImage(views[currentView].img, 0, 0, canvas.width, canvas.height);
                }
                ctx.restore();
                
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
                ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
                ctx.stroke();
                ctx.restore();
            }
        }

        function drawLine(p1, p2, c, txt, isTop = false) {
            const scale = canvas.width / 800;
            const fontSize = Math.max(22 * scale, 16);

            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.strokeStyle = c; ctx.lineWidth = 4 * scale; ctx.stroke();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p1.x, p1.y, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(p2.x, p2.y, 5 * scale, 0, Math.PI * 2); ctx.fill();
            if (txt) {
                let x = (p1.x + p2.x) / 2, y = (p1.y + p2.y) / 2;
                let parts = txt.split(': ');
                
                if (isTop) {
                    x = p1.y < p2.y ? p1.x : p2.x;
                    y = Math.min(p1.y, p2.y) - (30 * scale);
                    if (y < 30) y = Math.max(p1.y, p2.y) + (40 * scale);
                } else {
                    ctx.font = `bold ${fontSize}px 'Segoe UI'`;
                    let tempW = parts.length === 2 ? Math.max(ctx.measureText(parts[0]).width, ctx.measureText(parts[1]).width) : ctx.measureText(txt).width;
                    x = canvas.width - tempW / 2 - 20 * scale;

                    const rightP = p1.x > p2.x ? p1 : p2;
                    ctx.beginPath();
                    ctx.setLineDash([5 * scale, 5 * scale]);
                    ctx.moveTo(rightP.x + 5 * scale, rightP.y);
                    ctx.lineTo(x - tempW / 2 - 10 * scale, y);
                    ctx.strokeStyle = c;
                    ctx.lineWidth = 1.5 * scale;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                
                ctx.font = `bold ${fontSize}px 'Segoe UI'`;
                let w = parts.length === 2 ? Math.max(ctx.measureText(parts[0]).width, ctx.measureText(parts[1]).width) : ctx.measureText(txt).width;
                ctx.fillStyle = "rgba(24, 24, 27, 0.85)";
                
                let isMulti = parts.length === 2;
                let rh = isMulti ? (fontSize * 2 + 20 * scale) : (fontSize + 16 * scale);
                let ry = isMulti ? y - fontSize - 15 * scale : y - fontSize - 10 * scale;
                let rx = x - w / 2 - 10 * scale, rw = w + 20 * scale;
                
                ctx.fillRect(rx, ry, rw, rh);
                ctx.fillStyle = "#fff"; ctx.textAlign = "center";
                
                if (isMulti) {
                    ctx.fillText(parts[0], x, ry + fontSize + 4 * scale);
                    ctx.fillText(parts[1], x, ry + fontSize * 2 + 10 * scale);
                } else {
                    ctx.fillText(txt, x, y - 4 * scale);
                }
                
                ctx.strokeStyle = c; ctx.lineWidth = 2 * scale;
                ctx.strokeRect(rx, ry, rw, rh);
                return { x: rx, y: ry, w: rw, h: rh };
            }
            return null;
        }

        document.getElementById('btnAiDetect').onclick = function () {
            if (!views[currentView].img.src || !poseLandmarker) return alert("請先上傳照片並等待 AI 載入完成。");

            let realH = null;
            if (currentView === 'side' && views.front.refLine && views.front.refLine.real) {
                realH = views.front.refLine.real;
            } else {
                let defaultHeight = document.getElementById('refHeightInput').value || "175";
                let heightInput = prompt("開始 AI 測量前，請輸入被測量者的實際身高 (公分)：", defaultHeight);
                if (heightInput === null || heightInput.trim() === "" || isNaN(parseFloat(heightInput))) {
                    return;
                }
                realH = parseFloat(heightInput);
            }
            document.getElementById('refHeightInput').value = realH;

            cStatus.innerText = "AI 運算中...";
            const btnAi = document.getElementById('btnAiDetect');
            const originalBtnHtml = btnAi.innerHTML;
            btnAi.innerHTML = '<span style="display:inline-block; width:14px; height:14px; border:2px solid #fff; border-top:2px solid transparent; border-radius:50%; animation:spin 1s linear infinite; margin-right:8px; vertical-align:middle;"></span>運算中...';
            btnAi.disabled = true;
            document.body.style.cursor = 'wait';

            setTimeout(() => {
                let res;
                try {
                    res = poseLandmarker.detect(views[currentView].img);
                } catch (e) {
                    document.body.style.cursor = 'default';
                    btnAi.innerHTML = originalBtnHtml;
                    btnAi.disabled = false;
                    alert("AI 偵測發生錯誤");
                    return;
                }
                if (res.landmarks && res.landmarks.length > 0) {
                    const pose = res.landmarks[0], tX = v => v * canvas.width, tY = v => v * canvas.height;
                    const nose = pose[0], lSh = pose[11], rSh = pose[12], lHip = pose[23], rHip = pose[24], footY = Math.max(pose[29].y, pose[30].y, pose[31].y, pose[32].y);

                    let headY = nose.y - ((lSh.y + rSh.y) / 2 - nose.y) * 0.75; if (headY < 0) headY = 0.02;

                    const refCx = (tX(nose.x) + tX((pose[27].x + pose[28].x) / 2)) / 2;
                    views[currentView].refLine = { p1: { x: refCx, y: tY(headY) }, p2: { x: refCx, y: tY(footY) }, real: realH };
                    views[currentView].pxPerCm = dist(views[currentView].refLine.p1, views[currentView].refLine.p2) / realH;

                    const sL = { x: tX(lSh.x), y: tY(lSh.y) }, sR = { x: tX(rSh.x), y: tY(rSh.y) }, hL = { x: tX(lHip.x), y: tY(lHip.y) }, hR = { x: tX(rHip.x), y: tY(rHip.y) };
                    views[currentView].measureLines = [];
                    const calc = (pA, pB, multi = 1) => (dist(pA, pB) / views[currentView].pxPerCm * multi).toFixed(1);

                    const getRefX = (y) => {
                        const r1 = views[currentView].refLine.p1, r2 = views[currentView].refLine.p2;
                        return r2.y === r1.y ? r1.x : r1.x + (r2.x - r1.x) * (y - r1.y) / (r2.y - r1.y);
                    };

                    const makeLine = (p1, p2, f, yOffset) => {
                        const cy = (p1.y + p2.y) / 2 + yOffset;
                        const cx = getRefX(cy);
                        const halfW = Math.abs(p2.x - p1.x) / 2 * f;
                        return p1.x < p2.x ?
                            [{ x: cx - halfW, y: cy }, { x: cx + halfW, y: cy }] :
                            [{ x: cx + halfW, y: cy }, { x: cx - halfW, y: cy }];
                    };
                    
                    if (currentView === 'front') {
                        const [e_sL, e_sR] = makeLine(sL, sR, 1.25, 0);
                        const [c_L, c_R] = makeLine(sL, sR, 0.95, 75 * canvas.width / 800);
                        const [w_L, w_R] = makeLine(hL, hR, 1.3, -120 * canvas.width / 800);
                        const [hp_L, hp_R] = makeLine(hL, hR, 1.7, -35 * canvas.width / 800);

                        const shV = calc(e_sL, e_sR); views[currentView].measureLines.push({ p1: e_sL, p2: e_sR, name: '肩寬', val: shV, rawVal: dist(e_sL, e_sR)/views[currentView].pxPerCm, multiplier: 1, inputId: 'val-shoulder', baseLabel: '肩寬' }); document.getElementById('val-shoulder').value = shV;
                        const chV = calc(c_L, c_R, 2.6); views[currentView].measureLines.push({ p1: c_L, p2: c_R, name: '胸圍(推估)', val: chV, rawVal: dist(c_L, c_R)/views[currentView].pxPerCm, multiplier: 2.6, inputId: 'val-chest', baseLabel: '胸圍' }); document.getElementById('val-chest').value = chV;
                        const waV = calc(w_L, w_R, 2.4); views[currentView].measureLines.push({ p1: w_L, p2: w_R, name: '腰圍(推估)', val: waV, rawVal: dist(w_L, w_R)/views[currentView].pxPerCm, multiplier: 2.4, inputId: 'val-waist', baseLabel: '腰圍' }); document.getElementById('val-waist').value = waV;
                        const hipV = calc(hp_L, hp_R, 2.2); views[currentView].measureLines.push({ p1: hp_L, p2: hp_R, name: '臀圍(推估)', val: hipV, rawVal: dist(hp_L, hp_R)/views[currentView].pxPerCm, multiplier: 2.2, inputId: 'val-hip', baseLabel: '臀圍' }); document.getElementById('val-hip').value = hipV;
                    } else if (currentView === 'side') {
                        const frontRef = views.front.refLine;
                        if (frontRef && views.front.measureLines.length > 0) {
                            const frontH = frontRef.p2.y - frontRef.p1.y;
                            ['胸圍', '腰圍', '臀圍'].forEach(lbl => {
                                const fl = views.front.measureLines.find(l => l.baseLabel === lbl);
                                if (fl) {
                                    const ratioY = (fl.p1.y - frontRef.p1.y) / frontH;
                                    const sideY = views[currentView].refLine.p1.y + ratioY * (views[currentView].refLine.p2.y - views[currentView].refLine.p1.y);
                                    const cx = getRefX(sideY);
                                    const halfW = 12.5 * views[currentView].pxPerCm;
                                    const p1 = { x: cx - halfW, y: sideY };
                                    const p2 = { x: cx + halfW, y: sideY };
                                    let mult = 1; let inputId = '';
                                    if (lbl === '胸圍') { mult = 2.6; inputId = 'val-chest'; }
                                    else if (lbl === '腰圍') { mult = 2.4; inputId = 'val-waist'; }
                                    else if (lbl === '臀圍') { mult = 2.2; inputId = 'val-hip'; }
                                    views[currentView].measureLines.push({ p1: p1, p2: p2, name: lbl, rawVal: 25, multiplier: mult, inputId: inputId, baseLabel: lbl });
                                }
                            });
                        }
                    }

                    document.getElementById('val-height').value = realH;
                    document.getElementById('measureSource').value = "AI 自動量測";
                    setTool(null);
                    redraw();
                    cStatus.innerText = "AI 骨架偵測完成！線段節點可滑鼠拖曳微調。";
                } else { cStatus.innerText = "找不到人物，請手動量測。"; }
                
                document.body.style.cursor = 'default';
                btnAi.innerHTML = originalBtnHtml;
                btnAi.disabled = false;
            }, 50);
        };

        // ==========================================
        //  Cropper.js 裁切邏輯
        // ==========================================
        let cropper = null;
        
        window.openCropModal = function() {
            const imgSrc = views[currentView].img.src;
            if (!imgSrc || !views[currentView].img.hasAttribute('src')) {
                alert('請先上傳照片！');
                return;
            }
            
            const cropImage = document.getElementById('cropImage');
            cropImage.src = imgSrc;
            document.getElementById('cropModal').classList.add('active');
            
            if (cropper) { cropper.destroy(); }
            
            cropper = new Cropper(cropImage, {
                viewMode: 1,
                dragMode: 'crop',
                autoCropArea: 0.8,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
            });
        };
        
        window.closeCropModal = function() {
            document.getElementById('cropModal').classList.remove('active');
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
        };
        
        window.confirmCrop = function() {
            if (!cropper) return;
            const canvasData = cropper.getCroppedCanvas();
            if (!canvasData) { closeCropModal(); return; }
            
            const croppedDataUrl = canvasData.toDataURL("image/jpeg", 0.9);
            
            views[currentView].refLine = null;
            views[currentView].measureLines = [];
            views[currentView].pxPerCm = 0;
            
            cStatus.innerText = "重新載入裁切後的照片...";
            views[currentView].img.onload = function() {
                // Ensure it targets the view that was just cropped
                let targetView = currentView;
                canvas.width = views[targetView].img.width;
                canvas.height = views[targetView].img.height;
                window.resetCanvas();
                cStatus.innerText = targetView === 'front' ? "裁切完成。請重新設定基準或 AI 測量。" : "裁切完成。請手動拉線測量厚度。";
                document.getElementById('btnCenterUpload').style.display = 'none';
            };
            views[currentView].img.src = croppedDataUrl;
            
            closeCropModal();
        };

        // ==========================================
        //  3. 四步驟精靈與尺碼演算法
        // ==========================================
        const ITEMS_DEF = [
            { code: 'TL', name: '長袖戰術服', type: 'top', table: [['XS', 45, 97], ['S', 46, 102], ['M', 47, 107], ['L', 48, 112], ['XL', 50, 117], ['2XL', 51, 122], ['3XL', 52, 127]] },
            { code: 'TS', name: '短袖戰術服', type: 'top', table: [['XS', 45, 97], ['S', 46, 102], ['M', 47, 107], ['L', 48, 112], ['XL', 50, 117], ['2XL', 51, 122], ['3XL', 52, 127]] },
            { code: 'TV', name: '戰術背心', type: 'top', table: [['XS', 38, 98], ['S', 39, 103], ['M', 41, 108], ['L', 42, 113], ['XL', 43, 118], ['2XL', 44, 123], ['3XL', 46, 128]] },
            { code: 'OPL', name: '長袖操作服', type: 'top', table: [['XS', 45, 99], ['S', 46, 104], ['M', 47, 109], ['L', 48, 114], ['XL', 50, 119], ['2XL', 51, 125], ['3XL', 52, 130]] },
            { code: 'OPS', name: '短袖操作服', type: 'top', table: [['XS', 45, 99], ['S', 46, 104], ['M', 47, 109], ['L', 48, 114], ['XL', 50, 119], ['2XL', 51, 125], ['3XL', 52, 130]] },
            { code: 'EJ', name: '救護外套', type: 'top', table: [['XS', 46, 114], ['S', 48, 119], ['M', 49, 124], ['L', 50, 130], ['XL', 51, 135], ['2XL', 53, 140], ['3XL', 54, 145]] },
            { code: 'EV', name: '救護背心', type: 'vest', table: [['S', 38, 91, 98], ['M', 39, 101, 108], ['L', 40, 112, 118], ['XL', 42, 122, 128]] }
        ];

        function calcSize(item, sh, ch) {
            if (!sh && !ch) return 'M';
            const ease = item.code === 'EJ' ? 12 : 8;
            for (let r of item.table) {
                let shOk = !sh || sh <= r[1] + 1;
                let chOk = item.type === 'vest' ? (!ch || (ch >= r[2] - 6 && ch <= r[3] + 4)) : (!ch || (ch + ease) <= r[2]);
                if (shOk && chOk) return r[0];
            }
            return item.table[item.table.length - 1][0];
        }
        function calcPant(w, ins, hip) {
            let waistInch = Math.ceil((w / 2.54 + 1) / 2) * 2;
            if (hip > w + 14) waistInch += 2;
            let l = ins < 74 ? 30 : ins < 79 ? 32 : ins < 84 ? 34 : 36;
            return `W${waistInch}-L${l}`;
        }
        function calcShoe(f) {
            if (!f) return '';
            const sizes = [
                { cm: 22, jp: 34 }, { cm: 23, jp: 35 }, { cm: 24, jp: 36 }, { cm: 24.5, jp: 37 },
                { cm: 25, jp: 38 }, { cm: 25.5, jp: 39 }, { cm: 26, jp: 40 }, { cm: 27, jp: 41 },
                { cm: 28, jp: 42 }, { cm: 29, jp: 43 }
            ];
            let fv = parseFloat(f);
            for (let s of sizes) {
                if (s.cm >= fv) return `${s.cm % 1 === 0 ? s.cm + '.0' : s.cm} (日本號 ${s.jp})`;
            }
            return '29.0 (日本號 43)';
        }

        // ✅ 防呆版本的步驟切換邏輯
        window.goToStep = function (stepNum) {
            try {
                if (stepNum === 2) {
                    if (!document.getElementById('personId').value) return alert("請先選擇單位產生識別碼！");
                    if (!document.getElementById('personName').value) return alert("請填寫姓名！");
                }

                if (stepNum === 3) {
                    const h = document.getElementById('val-height').value, c = document.getElementById('val-chest').value;
                    if (!h || !c) return alert("請至少輸入身高與胸圍，系統才能為您推薦尺碼！");

                    currentRecordSizes = {};
                    const sh = parseFloat(document.getElementById('val-shoulder').value) || 0, ch = parseFloat(document.getElementById('val-chest').value) || 0;
                    const w = parseFloat(document.getElementById('val-waist').value) || 0, hip = parseFloat(document.getElementById('val-hip').value) || 0, ins = parseFloat(document.getElementById('val-inseam').value) || 0;

                    let html = '';
                    const addField = (lbl, code, opts, autoVal) => {
                        currentRecordSizes[code] = autoVal;
                        let optHtml = `<option value="">自動 (${autoVal})</option>` + opts.map(o => `<option value="${o}">${o}</option>`).join('');
                        html += `<div class="form-row"><div class="form-group" style="flex:1"><label>${lbl}</label><select id="sz_${code}">${optHtml}</select></div></div>`;
                    };

                    const selTAC = document.getElementById('chk-TAC').checked, selOPS = document.getElementById('chk-OPS').checked, selEMS = document.getElementById('chk-EMS').checked;
                    const allSz = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

                    if (selTAC) { addField('長袖戰術服 (TL)', 'TL', allSz, calcSize(ITEMS_DEF[0], sh, ch)); addField('短袖戰術服 (TS)', 'TS', allSz, calcSize(ITEMS_DEF[1], sh, ch)); addField('戰術背心 (TV)', 'TV', allSz, calcSize(ITEMS_DEF[2], sh, ch)); }
                    if (selOPS) { addField('長袖操作服 (OPL)', 'OPL', allSz, calcSize(ITEMS_DEF[3], sh, ch)); addField('短袖操作服 (OPS)', 'OPS', allSz, calcSize(ITEMS_DEF[4], sh, ch)); }
                    if (selEMS) { addField('救護外套 (EJ)', 'EJ', allSz, calcSize(ITEMS_DEF[5], sh, ch)); addField('救護背心 (EV)', 'EV', ['S', 'M', 'L', 'XL'], calcSize(ITEMS_DEF[6], sh, ch)); }
                    addField('戰術褲 (TP)', 'TP', [], calcPant(w, ins, hip));
                    addField('戰術腰帶', 'BELT', ['S', 'M', 'L', 'XL', '2XL'], w < 82 ? 'S' : w < 90 ? 'M' : w < 100 ? 'L' : w < 110 ? 'XL' : '2XL');
                    addField('戰術帽', 'CAP', ['S', 'M', 'L'], h < 165 ? 'S' : h < 178 ? 'M' : 'L');
                    const foot = document.getElementById('val-foot').value;
                    const shoeOpts = [
                        '22.0 (日本號 34)', '23.0 (日本號 35)', '24.0 (日本號 36)', '24.5 (日本號 37)',
                        '25.0 (日本號 38)', '25.5 (日本號 39)', '26.0 (日本號 40)', '27.0 (日本號 41)',
                        '28.0 (日本號 42)', '29.0 (日本號 43)'
                    ];
                    addField('消防靴', 'SHOE', shoeOpts, calcShoe(foot));

                    document.getElementById('sizing-fields').innerHTML = html;
                }

                if (stepNum === 4) {
                    const pId = document.getElementById('personId').value, pName = document.getElementById('personName').value, unit = document.getElementById('unitSelect').value;
                    const seriesCode = document.getElementById('chk-TAC').checked ? 'TAC' : (document.getElementById('chk-OPS').checked ? 'OPS' : 'EMS');
                    const dStr = (document.getElementById('registerDate').value || "").replace(/-/g, '').slice(2);
                    const bagNo = `${seriesCode}-${pId}-${dStr}`;

                    let kitText = "";['TL', 'TS', 'TV', 'OPL', 'OPS', 'EJ', 'EV', 'TP', 'BELT', 'CAP', 'SHOE'].forEach(k => {
                        const el = document.getElementById(`sz_${k}`);
                        if (el) { let finalVal = el.value || currentRecordSizes[k]; if (finalVal) kitText += `${k} : ${finalVal}<br>`; }
                    });

                    let dispSeries = [];
                    if (document.getElementById('chk-TAC').checked) dispSeries.push("TAC");
                    if (document.getElementById('chk-OPS').checked) dispSeries.push("OPS");
                    if (document.getElementById('chk-EMS').checked) dispSeries.push("EMS");

                    document.getElementById('labelContent').innerHTML = `
                    <b>PERSONAL ISSUE BAG</b><br>UNIT: ${unit}<br>NAME: ${pName}<br>ID: ${pId}<br>BAG NO: ${bagNo}<br>SERIES: ${dispSeries.join(", ")}<br>
                    <hr style="border:0; border-top:1px dashed #a1a1aa; margin:5px 0;"><b>CONTENT:</b><br>${kitText}
                `;

                    const sumName = document.getElementById('summaryName');
                    const sumUnit = document.getElementById('summaryUnit');
                    const sumBag = document.getElementById('summaryBagNo');
                    if (sumName) sumName.innerText = pName;
                    if (sumUnit) sumUnit.innerText = unit;
                    if (sumBag) sumBag.innerText = bagNo;

                    try {
                        document.getElementById('qrCodeContainer').innerHTML = "";
                        new QRCode(document.getElementById("qrCodeContainer"), { text: bagNo, width: 80, height: 80 });
                    } catch (qrErr) {
                        console.warn("QR 失敗", qrErr);
                        document.getElementById('qrCodeContainer').innerHTML = `<span style="font-size:10px;color:red;">QR失敗</span>`;
                    }

                    document.getElementById('btnSubmitToSheet').onclick = () => submitFinalData(bagNo);
                }

                document.querySelectorAll('.step-tab').forEach((el, i) => { el.classList.toggle('active', i + 1 === stepNum); });
                document.querySelectorAll('.step-content').forEach((el, i) => { el.classList.toggle('active', i + 1 === stepNum); });

            } catch (error) {
                console.error("切換失敗: ", error);
                alert("系統錯誤：\n" + error.message);
            }
        };

        function submitFinalData(bagNo) {
            const btn = document.getElementById('btnSubmitToSheet');
            btn.innerText = "⏳ 上傳雲端中...(需幾秒鐘)"; btn.disabled = true;

            const formData = new URLSearchParams();
            formData.append("action", "createRecord");
            formData.append("regDate", document.getElementById('registerDate').value);
            formData.append("agency", document.getElementById('agencySelect').value);
            formData.append("brigade", document.getElementById('brigadeSelect').value);
            formData.append("unit", document.getElementById('unitSelect').value);
            formData.append("personId", document.getElementById('personId').value);
            formData.append("bagNo", bagNo);

            formData.append("name", document.getElementById('personName').value);
            formData.append("gender", document.getElementById('personGender').value);
            formData.append("age", document.getElementById('personAge').value);
            formData.append("job", document.getElementById('personJob').value);
            formData.append("source", document.getElementById('measureSource').value);
            formData.append("filename", uploadedFileName);

            formData.append("height", document.getElementById('val-height').value);
            formData.append("shoulder", document.getElementById('val-shoulder').value);
            formData.append("chest", document.getElementById('val-chest').value);
            formData.append("waist", document.getElementById('val-waist').value);
            formData.append("hip", document.getElementById('val-hip').value);
            formData.append("inseam", document.getElementById('val-inseam').value);

            let seriesArr = [];
            if (document.getElementById('chk-TAC').checked) seriesArr.push("TAC");
            if (document.getElementById('chk-OPS').checked) seriesArr.push("OPS");
            if (document.getElementById('chk-EMS').checked) seriesArr.push("EMS");
            formData.append("series", seriesArr.join(", "));

            const getFinalSz = (code) => { const el = document.getElementById(`sz_${code}`); return el ? (el.value || currentRecordSizes[code]) : ""; };
            formData.append("sz_long", getFinalSz('TL') || getFinalSz('OPL')); formData.append("sz_short", getFinalSz('TS') || getFinalSz('OPS'));
            formData.append("sz_vest", getFinalSz('TV') || getFinalSz('EV')); formData.append("sz_jacket", getFinalSz('EJ'));
            formData.append("sz_pant", getFinalSz('TP')); formData.append("sz_belt", getFinalSz('BELT'));
            formData.append("sz_cap", getFinalSz('CAP')); formData.append("sz_shoe", getFinalSz('SHOE'));

            formData.append("note", document.getElementById('val-note').value);

            let finalDataURL = "";
            if (views.front.img.src || views.side.img.src) {
                const originalView = currentView;
                
                const renderToTemp = (v) => {
                    if (!views[v].img.src) return null;
                    currentView = v;
                    canvas.width = views[v].img.width;
                    canvas.height = views[v].img.height;
                    redraw();
                    const tc = document.createElement('canvas');
                    tc.width = canvas.width; tc.height = canvas.height;
                    tc.getContext('2d').drawImage(canvas, 0, 0);
                    return tc;
                };
                
                const frontC = renderToTemp('front');
                const sideC = renderToTemp('side');
                
                if (frontC && sideC) {
                    const mergeC = document.createElement('canvas');
                    const maxH = Math.max(frontC.height, sideC.height);
                    const scaleF = maxH / frontC.height;
                    const scaleS = maxH / sideC.height;
                    const newW_F = frontC.width * scaleF;
                    const newW_S = sideC.width * scaleS;
                    
                    mergeC.width = newW_F + newW_S;
                    mergeC.height = maxH;
                    const mCtx = mergeC.getContext('2d');
                    mCtx.drawImage(frontC, 0, 0, newW_F, maxH);
                    mCtx.drawImage(sideC, newW_F, 0, newW_S, maxH);
                    
                    finalDataURL = mergeC.toDataURL("image/jpeg", 0.7);
                } else if (frontC) {
                    finalDataURL = frontC.toDataURL("image/jpeg", 0.7);
                } else if (sideC) {
                    finalDataURL = sideC.toDataURL("image/jpeg", 0.7);
                }
                
                // Restore original view
                currentView = originalView;
                if (views[currentView].img.src) {
                    canvas.width = views[currentView].img.width;
                    canvas.height = views[currentView].img.height;
                } else {
                    canvas.width = 0; canvas.height = 0;
                }
                redraw();
            }

            if (finalDataURL) {
                formData.append("fileData", finalDataURL);
            }

            fetch(APPS_SCRIPT_URL, { method: "POST", body: formData })
                .then(() => {
                    const st = document.getElementById('submitStatus');
                    st.className = "status-box success"; st.style.display = "block";
                    st.innerHTML = `✅ 資料與截圖皆已成功寫入雲端！`;
                    btn.innerText = "☁️ 上傳雲端存檔"; btn.disabled = false;
                    document.getElementById('submitBtns').style.display = 'none';
                    document.getElementById('nextPersonZone').style.display = 'block';
                }).catch(err => {
                    alert("⚠️ 網路請求已送出。若 GAS 設定正確資料應已寫入！");
                    btn.innerText = "☁️ 上傳雲端存檔"; btn.disabled = false;
                });
        }

        // 🚀 測量下一位
        window.measureNext = function () {
            document.getElementById('personName').value = ''; document.getElementById('personAge').value = '';
            document.getElementById('personGender').value = ''; document.getElementById('personJob').value = '';
            document.getElementById('val-height').value = ''; document.getElementById('val-shoulder').value = '';
            document.getElementById('val-chest').value = ''; document.getElementById('val-waist').value = '';
            document.getElementById('val-hip').value = ''; document.getElementById('val-inseam').value = '';
            document.getElementById('val-foot').value = ''; document.getElementById('val-note').value = '';

            document.getElementById('submitStatus').style.display = 'none';
            document.getElementById('submitBtns').style.display = 'flex';
            document.getElementById('nextPersonZone').style.display = 'none';

            document.getElementById('unitSelect').dispatchEvent(new Event('change'));

            document.getElementById('imageUpload').value = '';
            document.getElementById('imageUploadSide').value = '';
            views.front.img = new Image();
            views.side.img = new Image();
            
            views.front.refLine = null; views.front.measureLines = []; views.front.pxPerCm = 0;
            views.side.refLine = null; views.side.measureLines = []; views.side.pxPerCm = 0;

            window.resetCanvas();
            setTimeout(() => { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; }, 10);

            uploadedFileName = "無正面照片";
            uploadedFileNameSide = "無側面照片";
            document.getElementById('fileNameDisplay').innerText = '點擊選擇照片';
            document.getElementById('fileNameDisplay').style.borderColor = "var(--border)";
            document.getElementById('fileNameDisplay').style.color = "var(--text-muted)";
            cStatus.innerText = '等待載入照片...';
            document.getElementById('btnCenterUpload').style.display = 'flex';
            
            window.switchCanvasView('front');
            goToStep(1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        // ==========================================
        //  4. 靜態尺碼對照表
        // ==========================================
        const renderStaticChart = () => {
            let html = '';
            ITEMS_DEF.forEach(item => {
                html += `<h3 style="padding: 15px; margin: 0; background: var(--bg-surface); border-bottom: 1px solid var(--border); color:var(--text-main); font-size:15px;">${item.name} (${item.code})</h3>
            <div style="overflow-x: auto; margin-bottom: 30px;">
                <table class="sct"><thead><tr><th>尺碼</th>${item.type === 'vest' ? '<th>肩寬(cm)</th><th>胸圍最小(cm)</th><th>胸圍最大(cm)</th>' : '<th>肩寬(cm)</th><th>胸圍(cm)</th>'}</tr></thead>
                <tbody>${item.table.map(r => `<tr><td><span class="sz-badge">${r[0]}</span></td>${r.slice(1).map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            });
            html += `<h3 style="padding: 15px; margin: 0; background: var(--bg-surface); border-bottom: 1px solid var(--border); color:var(--text-main); font-size:15px;">消防靴 (SHOE)</h3>
        <div style="overflow-x: auto; margin-bottom: 30px;">
            <table class="sct"><thead><tr><th>腳長(cm)</th><th>日本號</th></tr></thead>
            <tbody>
                <tr><td><span class="sz-badge">22.0</span></td><td>34</td></tr>
                <tr><td><span class="sz-badge">23.0</span></td><td>35</td></tr>
                <tr><td><span class="sz-badge">24.0</span></td><td>36</td></tr>
                <tr><td><span class="sz-badge">24.5</span></td><td>37</td></tr>
                <tr><td><span class="sz-badge">25.0</span></td><td>38</td></tr>
                <tr><td><span class="sz-badge">25.5</span></td><td>39</td></tr>
                <tr><td><span class="sz-badge">26.0</span></td><td>40</td></tr>
                <tr><td><span class="sz-badge">27.0</span></td><td>41</td></tr>
                <tr><td><span class="sz-badge">28.0</span></td><td>42</td></tr>
                <tr><td><span class="sz-badge">29.0</span></td><td>43</td></tr>
            </tbody></table>
        </div>`;
            document.getElementById('static-chart-container').innerHTML = html;
        };
        renderStaticChart();

        // ==========================================
        //  5. 後台管理與列印共用過濾資料
        // ==========================================
        document.getElementById('adminPwdInput').addEventListener('keypress', e => { if (e.key === 'Enter') window.loginAdmin(); });

        window.loginAdmin = async function () {
            const pwd = document.getElementById('adminPwdInput').value, btn = document.querySelector('.login-box button'), errorMsg = document.getElementById('loginError');
            btn.innerText = "驗證中..."; btn.disabled = true; errorMsg.style.display = 'none';
            try {
                const url = APPS_SCRIPT_URL + (APPS_SCRIPT_URL.includes('?') ? '&' : '?') + `action=getRecords&password=${encodeURIComponent(pwd)}`;
                const res = await fetch(url);
                const textData = await res.text();
                let data; try { data = JSON.parse(textData); } catch (err) { throw new Error("API_NOT_JSON"); }
                if (data.error) { errorMsg.innerText = data.error; errorMsg.style.display = 'block'; btn.innerText = "登入"; btn.disabled = false; }
                else if (!Array.isArray(data)) { throw new Error("VERSION_MISMATCH"); }
                else {
                    document.getElementById('loginOverlay').style.display = 'none';
                    adminLoggedIn = true; savedAdminPwd = pwd; allRecords = data;
                    window.refreshAdminData(true).then(() => {
                        if (document.getElementById('view-labels').classList.contains('active')) {
                            document.getElementById('btnLblInner').click();
                        }
                    });
                }
            } catch (e) {
                if (e.message === "VERSION_MISMATCH" || e.message === "API_NOT_JSON") alert("後端未更新！請回 Apps Script 發佈新版本。"); else alert("連線失敗！請檢查網路。");
                btn.innerText = "登入"; btn.disabled = false;
            }
        };

        window.refreshAdminData = async function (isSilent = false) {
            if (!adminLoggedIn) return;
            const rBtn = document.querySelector('.btn-ghost[onclick="refreshAdminData()"]');
            if (!isSilent && rBtn) rBtn.innerText = "更新中...";
            try {
                const url = APPS_SCRIPT_URL + (APPS_SCRIPT_URL.includes('?') ? '&' : '?') + `action=getRecords&password=${encodeURIComponent(savedAdminPwd)}`;
                const res = await fetch(url); const data = await res.json();
                if (Array.isArray(data)) {
                    allRecords = data;
                    renderAdminBoard();
                    populateLabelFilters();
                    if (document.getElementById('view-labels').classList.contains('active')) {
                        renderLabels(currentLabelType);
                    }
                }
            } catch (e) { console.error("更新失敗"); }
            if (!isSilent && rBtn) rBtn.innerText = "重新整理";
        };

        function renderAdminBoard() {
            if (document.getElementById('view-admin').classList.contains('active')) {
                document.getElementById('dashTotal').innerText = allRecords.length;
                document.getElementById('dashMale').innerText = allRecords.filter(r => r['性別'] === '男').length;
                document.getElementById('dashFemale').innerText = allRecords.filter(r => r['性別'] === '女').length;

                const units = new Set(); allRecords.forEach(r => { if (r['單位名稱']) units.add(r['單位名稱']); });
                const fU = document.getElementById('filterUnit');
                const currUnit = fU.value;
                fU.innerHTML = '<option value="">所有單位</option>'; units.forEach(u => fU.innerHTML += `<option value="${u}">${u}</option>`);
                fU.value = currUnit;

                document.getElementById('filterAgency').onchange = filterTable; document.getElementById('filterUnit').onchange = filterTable; document.getElementById('filterSearch').oninput = filterTable;
                filterTable();
            }
        }

        function filterTable() {
            const vA = document.getElementById('filterAgency').value, vU = document.getElementById('filterUnit').value, vS = document.getElementById('filterSearch').value.toLowerCase();
            const filtered = allRecords.filter(r => {
                if (vA && r['機關名稱'] !== vA) return false; if (vU && r['單位名稱'] !== vU) return false;
                if (vS && !(r['姓名'].toLowerCase().includes(vS) || r['人員識別碼'].toLowerCase().includes(vS) || r['裝袋序號'].toLowerCase().includes(vS))) return false;
                return true;
            });
            const tbody = document.getElementById('tableBody'); tbody.innerHTML = '';
            filtered.forEach(r => {
                const st = r['狀態'] || '待確認'; const sizes = `${r['身高']} / ${r['肩寬']} / ${r['胸圍']} / ${r['腰圍']} / ${r['臀圍']}`;
                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="font-family:monospace; color:var(--primary); font-weight:bold;">${r['裝袋序號']}</td><td>${r['單位名稱']}</td><td><strong>${r['姓名']}</strong></td><td>${r['性別']}</td><td><span class="tag-status st-${st}">${st}</span></td><td>${r['登記日期']}</td><td style="color:var(--text-muted); font-size:12px;">${sizes}</td>`;
                tr.onclick = () => showModal(r); tbody.appendChild(tr);
            });
        }

        function getDriveThumbnailUrl(url) {
            if (!url || !url.includes('drive.google.com/file/d/')) return '';
            const match = url.match(/\/d\/(.*?)\//); return match ? `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000` : url;
        }

        window.showModal = function (r) {
            document.getElementById('detailModal').classList.add('active'); window.toggleEditMode(false);

            document.getElementById('mBagNo').innerText = r['裝袋序號']; document.getElementById('mPersonId').innerText = r['人員識別碼'];
            document.getElementById('mName').innerText = r['姓名']; document.getElementById('mUnit').innerText = r['單位名稱'];
            document.getElementById('mBodySize').innerText = `${r['身高']} / ${r['肩寬']} / ${r['胸圍']} / ${r['腰圍']} / ${r['臀圍']}`;
            document.getElementById('mDate').innerText = r['登記日期'];
            if (document.getElementById('mSeries')) document.getElementById('mSeries').innerText = r['配發系列'] || '-';
            if (document.getElementById('mSource')) document.getElementById('mSource').innerText = r['量測方式'] || '-';

            document.getElementById('mStatus_txt').innerText = r['狀態']; document.getElementById('mStatus_txt').className = `edit-txt tag-status st-${r['狀態']}`;
            document.getElementById('mStatus_inp').value = r['狀態'];
            document.getElementById('mAdminNote_txt').innerText = r['後台備註'] || '無'; document.getElementById('mAdminNote_inp').value = r['後台備註'] || '';

            const szObj = r.sizes || {}; let szHtml = '';
            const szFields = [{ k: 'TL', l: '長袖' }, { k: 'TS', l: '短袖' }, { k: 'TV', l: '背心' }, { k: 'EJ', l: '外套' }, { k: 'TP', l: '戰術褲' }, { k: 'BELT', l: '褲帶' }, { k: 'CAP', l: '戰術帽' }, { k: 'SHOE', l: '消防靴' }];

            szFields.forEach(f => {
                const val = szObj[f.k] || '';
                szHtml += `<div class="info-item"><span>${f.l}</span><strong class="edit-txt" style="color:var(--primary);">${val || '-'}</strong><input type="text" id="mSz_${f.k}" class="edit-inp" value="${val}" placeholder="輸入尺碼"></div>`;
            });
            document.getElementById('modalSizingArea').innerHTML = szHtml;

            const imgEl = document.getElementById('modalImg'), loadText = document.getElementById('loadingImg');
            imgEl.style.display = 'none'; loadText.style.display = 'block';
            if (r['照片連結'] && r['照片連結'].startsWith('http')) { loadText.innerText = "載入照片中..."; imgEl.src = getDriveThumbnailUrl(r['照片連結']); } else { loadText.innerText = "無照片紀錄"; }
        };
        window.closeModal = function () { document.getElementById('detailModal').classList.remove('active'); };

        window.toggleEditMode = function (isEdit) {
            const txts = document.querySelectorAll('.edit-txt'), inps = document.querySelectorAll('.edit-inp');
            if (isEdit) {
                txts.forEach(t => t.style.display = 'none'); inps.forEach(i => i.style.display = 'block');
                document.getElementById('btnToggleEdit').style.display = 'none'; document.getElementById('btnSaveEdit').style.display = 'inline-block'; document.getElementById('btnCancelEdit').style.display = 'inline-block';
            } else {
                txts.forEach(t => t.style.display = 'block'); inps.forEach(i => i.style.display = 'none');
                document.getElementById('btnToggleEdit').style.display = 'inline-block'; document.getElementById('btnSaveEdit').style.display = 'none'; document.getElementById('btnCancelEdit').style.display = 'none';
            }
        };

        window.saveEditInfo = async function () {
            const btnSave = document.getElementById('btnSaveEdit'); btnSave.innerText = "儲存中..."; btnSave.disabled = true;
            const formData = new URLSearchParams();
            formData.append("action", "updateRecord"); formData.append("bagNo", document.getElementById('mBagNo').innerText);
            formData.append("status", document.getElementById('mStatus_inp').value); formData.append("adminNote", document.getElementById('mAdminNote_inp').value);
            formData.append("sz_long", document.getElementById('mSz_TL').value); formData.append("sz_short", document.getElementById('mSz_TS').value); formData.append("sz_vest", document.getElementById('mSz_TV').value);
            formData.append("sz_jacket", document.getElementById('mSz_EJ').value); formData.append("sz_pant", document.getElementById('mSz_TP').value); formData.append("sz_belt", document.getElementById('mSz_BELT').value);
            formData.append("sz_cap", document.getElementById('mSz_CAP').value); formData.append("sz_shoe", document.getElementById('mSz_SHOE').value);
            try {
                const res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: formData }); const result = await res.json();
                if (result.success) { alert("修改成功！"); window.toggleEditMode(false); window.refreshAdminData(true); } else alert("修改失敗：" + (result.error || "未知錯誤"));
            } catch (e) { alert("儲存失敗，請檢查網路。"); }
            btnSave.innerText = "儲存"; btnSave.disabled = false;
        };

        // ==========================================
        //  6. 標籤列印邏輯
        // ==========================================
        window.populateLabelFilters = function () {
            const agencies = new Set(), brigades = new Set(), units = new Set();
            allRecords.forEach(r => {
                if (r['機關名稱']) agencies.add(r['機關名稱']);
                if (r['大隊/分類']) brigades.add(r['大隊/分類']);
                if (r['單位名稱']) units.add(r['單位名稱']);
            });
            const fA = document.getElementById('lblFiltAgency'), fB = document.getElementById('lblFiltBrigade'), fU = document.getElementById('lblFiltUnit');
            const cA = fA.value, cB = fB.value, cU = fU.value;

            fA.innerHTML = '<option value="">所有機關</option>'; agencies.forEach(a => fA.innerHTML += `<option value="${a}">${a}</option>`);
            fB.innerHTML = '<option value="">所有大隊</option>'; brigades.forEach(b => fB.innerHTML += `<option value="${b}">${b}</option>`);
            fU.innerHTML = '<option value="">所有單位</option>'; units.forEach(u => fU.innerHTML += `<option value="${u}">${u}</option>`);

            fA.value = cA; fB.value = cB; fU.value = cU;
        };

        window.applyLabelFilter = function () {
            renderLabels(currentLabelType);
        };

        window.renderLabels = function (type) {
            currentLabelType = type;
            document.querySelectorAll('.toolbar .btn-outline').forEach(b => b.classList.remove('active'));
            if (event && event.target && event.target.classList.contains('btn-outline')) event.target.classList.add('active');

            const renderArea = document.getElementById('labelRenderArea');
            document.getElementById('reserveInputArea').style.display = (type === 'reserve') ? 'block' : 'none';
            document.getElementById('labelFilterArea').style.display = (type === 'inner' || type === 'squad') ? 'block' : 'none';

            renderArea.innerHTML = '';
            if (!allRecords || allRecords.length === 0) { renderArea.innerHTML = '<div style="color:var(--danger); padding:20px;">無資料可產生標籤，請先登入後台確認數據。</div>'; return; }

            let targetRecords = allRecords;
            if (type === 'inner' || type === 'squad') {
                const vA = document.getElementById('lblFiltAgency').value, vB = document.getElementById('lblFiltBrigade').value, vU = document.getElementById('lblFiltUnit').value;
                targetRecords = allRecords.filter(r => {
                    if (vA && r['機關名稱'] !== vA) return false;
                    if (vB && r['大隊/分類'] !== vB) return false;
                    if (vU && r['單位名稱'] !== vU) return false;
                    return true;
                });
            }

            if (targetRecords.length === 0) {
                renderArea.innerHTML = '<div style="color:var(--text-muted); padding:20px;">該條件下無符合的標籤資料。</div>'; return;
            }

            let html = ''; labelQRCodes = [];

            if (type === 'inner') {
                targetRecords.forEach((r, idx) => {
                    let kit = '';
                    if (r.sizes) { ['TL', 'TS', 'TV', 'OPL', 'OPS', 'EJ', 'EV', 'TP', 'BELT', 'CAP', 'SHOE'].forEach(k => { if (r.sizes[k]) kit += `<div>　${k} : ${r.sizes[k]}</div>`; }); }
                    const qrId = `qr_inner_${idx}`;
                    html += `<div class="label-card"><div class="label-text"><div style="font-weight:bold; font-size:16px; border-bottom:2px solid #000; margin-bottom:10px;">PERSONAL ISSUE BAG</div>
                    <div>UNIT: ${r['機關名稱']}</div><div>SQUAD: ${r['大隊/分類']} - ${r['單位名稱']}</div><div>NAME: ${r['姓名']}</div><div>PERSON ID: ${r['人員識別碼']}</div><div>SERIES: ${r['配發系列'] || '-'}</div>
                    <div style="margin-top:10px; border-top:1px dashed #a1a1aa; padding-top:10px;"><strong>KIT CONTENT:</strong><br>${kit}</div></div>
                    <div class="label-qr-wrap"><div style="font-size:11px; color:#555;">BAG NO:<br>${r['裝袋序號']}</div><div id="${qrId}" class="qr-box"></div></div></div>`;
                    labelQRCodes.push({ id: qrId, text: r['裝袋序號'] });
                });
            }
            else if (type === 'squad') {
                const squads = {};
                targetRecords.forEach(r => { const key = `${r['機關名稱']}_${r['大隊/分類']}_${r['單位名稱']}`; if (!squads[key]) squads[key] = []; squads[key].push(r); });
                Object.keys(squads).forEach((k, idx) => {
                    const group = squads[k]; const first = group[0];
                    const boxNo = `${first['人員識別碼'].split('-')[0]}-${first['人員識別碼'].split('-')[1]}-01`;
                    const qrId = `qr_squad_${idx}`;
                    html += `<div class="label-card"><div class="label-text"><div style="font-weight:bold; font-size:16px; border-bottom:2px solid #000; margin-bottom:10px;">SQUAD BOX</div>
                    <div>UNIT: ${first['機關名稱']}</div><div>SQUAD: ${first['單位名稱']}</div><div>BOX NO: ${boxNo}</div><div>PERSON COUNT: ${group.length}</div>
                    <div style="margin-top:10px; border-top:1px dashed #a1a1aa; padding-top:10px;"><strong>CONTENT:</strong><br><div>　PERSONAL KIT × ${group.length}</div></div>
                    <div style="margin-top:5px; font-size:11px; color:#555;">NOTE: 本箱為完整個人配發袋</div></div>
                    <div class="label-qr-wrap"><div style="font-size:11px; color:#555;">掃描確認分隊資料</div><div id="${qrId}" class="qr-box"></div></div></div>`;
                    labelQRCodes.push({ id: qrId, text: boxNo });
                });
            }
            else if (type === 'unit') {
                const units = {};
                allRecords.forEach(r => { if (!units[r['機關名稱']]) units[r['機關名稱']] = 1; else units[r['機關名稱']]++; });
                Object.keys(units).forEach((u, idx) => {
                    const qrId = `qr_unit_${idx}`;
                    html += `<div class="label-card"><div class="label-text"><div style="font-weight:bold; font-size:16px; border-bottom:2px solid #000; margin-bottom:10px;">UNIT SUPPLY CRATE</div>
                    <div>UNIT: ${u}</div><div>TOTAL BOX: ________</div><div>THIS BOX: ________</div>
                    <div style="margin-top:10px; border-top:1px dashed #a1a1aa; padding-top:10px;"><strong>CONTENT TYPE:</strong><br><div>　PERSONAL KIT + RESERVE ITEMS</div></div>
                    <div style="margin-top:10px;">DELIVERY POINT:<br><strong>${u}</strong></div></div>
                    <div class="label-qr-wrap"><div id="${qrId}" class="qr-box"></div></div></div>`;
                    labelQRCodes.push({ id: qrId, text: u });
                });
            }
            renderArea.innerHTML = html;
            setTimeout(() => { labelQRCodes.forEach(qr => { try { new QRCode(document.getElementById(qr.id), { text: qr.text, width: 64, height: 64 }); } catch (e) { } }); }, 100);
        };

        window.addReserveLabel = function () {
            const item = document.getElementById('resItem').value, size = document.getElementById('resSize').value, qty = document.getElementById('resQty').value;
            const box = document.getElementById('resBox').value, usage = document.getElementById('resUsage').value;
            if (!item || !size || !qty) return alert("請填寫品項、尺寸與數量！");
            const qrId = `qr_res_${Date.now()}`;
            const html = `<div class="label-card"><div class="label-text"><div style="font-weight:bold; font-size:16px; border-bottom:2px solid #000; margin-bottom:10px;">RESERVE BOX</div>
            <div>ITEM: ${item}</div><div>SIZE: ${size}</div><div>QTY: ${qty}</div><div>BOX NO: ${box}</div>
            <div style="margin-top:10px; border-top:1px dashed #a1a1aa; padding-top:10px;">USAGE:<br>${usage}</div></div>
            <div class="label-qr-wrap"><div id="${qrId}" class="qr-box"></div></div></div>`;
            document.getElementById('labelRenderArea').insertAdjacentHTML('afterbegin', html);
            setTimeout(() => { try { new QRCode(document.getElementById(qrId), { text: `RES-${item}-${size}`, width: 64, height: 64 }); } catch (e) { } }, 100);
        };

        window.RESERVE_ITEMS = {
            "長袖戰術服": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "短袖戰術服": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "戰術背心": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "長袖操作服": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "短袖操作服": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "救護外套": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "救護背心": ["S", "M", "L", "XL"],
            "戰術褲": ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
            "消防靴": ["22.0", "23.0", "24.0", "24.5", "25.0", "25.5", "26.0", "27.0", "28.0", "29.0"]
        };

        const initResItems = function () {
            const itemSelect = document.getElementById('resItem');
            if (itemSelect) {
                Object.keys(window.RESERVE_ITEMS).forEach(item => {
                    itemSelect.innerHTML += `<option value="${item}">${item}</option>`;
                });
            }
        };
        initResItems();

        window.updateResSizeOptions = function () {
            const item = document.getElementById('resItem').value;
            const sizeSelect = document.getElementById('resSize');
            sizeSelect.innerHTML = '<option value="">選擇尺寸</option>';
            if (item && window.RESERVE_ITEMS[item]) {
                window.RESERVE_ITEMS[item].forEach(sz => {
                    sizeSelect.innerHTML += `<option value="${sz}">${sz}</option>`;
                });
            }
        };

        window.exportCSV = function () {
            if (allRecords.length === 0) return alert("目前沒有資料可匯出！");
            let csvContent = "\uFEFF";
            const headers = ["裝袋序號", "系統建檔時間", "機關名稱", "大隊/分類", "單位名稱", "人員識別碼", "姓名", "性別", "身高", "肩寬", "胸圍", "腰圍", "臀圍", "配發系列", "長袖", "短袖", "背心", "外套", "戰術褲", "狀態", "後台備註"];
            csvContent += headers.join(",") + "\r\n";
            allRecords.forEach(r => { let row = headers.map(h => { let cell = r[h] === undefined ? "" : r[h].toString(); cell = cell.replace(/"/g, '""'); return `"${cell}"`; }); csvContent += row.join(",") + "\r\n"; });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob));
            link.setAttribute("download", `FIRESCUE_資料匯出_${new Date().toISOString().slice(0, 10)}.csv`);
            link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
        };
    