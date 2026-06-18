import docx
import sys

try:
    doc = docx.Document('消防制服尺寸推薦系統規格書_V1.2_工程師版.docx')
    with open('docx_content.txt', 'w', encoding='utf-8') as f:
        for p in doc.paragraphs:
            f.write(p.text + '\n')
    print("Done")
except Exception as e:
    print("Error:", e)
