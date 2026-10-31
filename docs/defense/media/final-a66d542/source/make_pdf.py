from pathlib import Path
from reportlab.pdfgen import canvas
from pypdf import PdfReader

root = Path(__file__).resolve().parents[2]
render_dir = root / 'work/final-media/build/renders'
out = root / 'work/final-media/exports/green-pavlodar-defense-a66d542.pdf'
c = canvas.Canvas(str(out), pagesize=(1600, 900))
c.setTitle('Green Pavlodar - demonstration a66d542 - mock')
c.setAuthor('Green Pavlodar: Damir, Bekzat, Aidana, Tanirberdi')
c.setSubject('Code a66d542c63c527d608400c84b34d49f982855369; 5-minute working scenario; independent acceptance not claimed')
for image in sorted(render_dir.glob('slide-*.png')):
    c.drawImage(str(image), 0, 0, width=1600, height=900)
    c.showPage()
c.save()
r = PdfReader(out)
assert len(r.pages) == 9
assert all(float(p.mediabox.width) == 1600 and float(p.mediabox.height) == 900 for p in r.pages)
print(out)
print('9 pages, 1600 x 900 pt; PDF slides preserve the inspected raster rendering')
