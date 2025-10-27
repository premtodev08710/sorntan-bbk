import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/** Firebase config (เหมือนโปรเจกต์หลัก) */
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: ""
};


const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* ===== Utilities ===== */
function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function fillThaiDate(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const dayNames = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  const months   = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  document.getElementById('thDay').textContent   = dayNames[d.getDay()];
  document.getElementById('thDate').textContent  = String(d.getDate());
  document.getElementById('thMonth').textContent = months[d.getMonth()];
  document.getElementById('thYear').textContent  = String(d.getFullYear() + 543);
}

function groupByTeacher(rows){
  const map = new Map();
  rows.forEach(r=>{
    const key = r.absentTeacherId || r.absentTeacherName;
    if(!map.has(key)){
      map.set(key, { name:r.absentTeacherName, reason:r.reason, teaches:[] });
    }
    map.get(key).teaches.push({
      period: r.period,
      time: r.time,
      subject: r.subject,
      klass: r.klass,
      substitute: r.substituteName
    });
  });
  // เรียงตามชื่อครูที่ไม่มาปฏิบัติ
  return Array.from(map.values()).sort((a,b)=> (a.name||"").localeCompare(b.name||"", "th-TH"));
}

/* ===== Render ===== */
async function loadAndRender(){
  const dateStr = getParam('date');
  if(!dateStr){ alert('ไม่พบพารามิเตอร์ ?date=YYYY-MM-DD'); return; }

  fillThaiDate(dateStr);

  // ดึงประวัติการสอนแทนของวันนั้นทั้งหมด
  const q = query(collection(db, 'substitutions'), where('date', '==', dateStr));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => d.data());

  const tbody = document.getElementById('printBody');
  tbody.innerHTML = '';

  if(rows.length === 0){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="9" style="text-align:center;">ไม่มีรายการสอนแทนสำหรับวันที่ ${dateStr}</td>`;
    tbody.appendChild(tr);
    return;
  }

  // จัดกลุ่มตามครูที่ขาด เพื่อทำ rowspan 3 คอลัมน์แรก
  const groups = groupByTeacher(rows);

  groups.forEach((group, idx) => {
    const teaches = group.teaches.sort((a,b)=> a.period - b.period);

    teaches.forEach((t, i) => {
      const tr = document.createElement('tr');

      // 3 คอลัมน์แรก (เลขที่/ครูที่ขาด/สาเหตุ) ใช้ rowspan เท่าจำนวนคาบของครูคนนั้น
      if(i === 0){
        tr.innerHTML = `
          <td rowspan="${teaches.length}">${idx + 1}</td>
          <td rowspan="${teaches.length}">${group.name || ''}</td>
          <td rowspan="${teaches.length}">${group.reason || ''}</td>

          <td>${t.period}</td>
          <td>${t.time}</td>
          <td>${t.subject || ''}</td>
          <td>${t.klass || ''}</td>
          <td>${t.substitute || ''}</td>

          <!-- ช่องลงนามสำหรับครูที่สอนแทน (ต่อแถว) -->
          <td class="signature">
            <div class="signature-lines">
              <div class="row"><span class="label">ลงชื่อ</span><span class="line"></span></div>
            </div>
          </td>
        `;
      } else {
        // แถวถัด ๆ ไป เติมเฉพาะข้อมูลรายคาบ + ช่องลงนาม
        tr.innerHTML = `
          <td>${t.period}</td>
          <td>${t.time}</td>
          <td>${t.subject || ''}</td>
          <td>${t.klass || ''}</td>
          <td>${t.substitute || ''}</td>

          <td class="signature">
            <div class="signature-lines">
              <div class="row"><span class="label">ลงชื่อ</span><span class="line"></span></div>
            </div>
          </td>
        `;
      }

      tbody.appendChild(tr);
    });
  });
}

/* ===== Events ===== */
document.getElementById('btnBack').addEventListener('click', () => history.back());
document.getElementById('btnPrint').addEventListener('click', () => window.print());

loadAndRender().catch(err => {
  console.error(err);
  alert('โหลดข้อมูลไม่สำเร็จ: ' + (err?.message || err));
});
