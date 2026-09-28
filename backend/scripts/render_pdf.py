import sys
import os
import json
import pymupdf

# Target resolution for the main display (full 1080p)
DISPLAY_WIDTH = 1920

# Thumbnail resolution for admin panel previews (480x270 WebP)
# Much smaller: ~10x faster to load, ~5x less disk space
THUMB_WIDTH = 480


def render_pdf(pdf_path, output_dir):
    if not os.path.exists(pdf_path):
        return {"success": False, "error": f"PDF not found at {pdf_path}"}

    os.makedirs(output_dir, exist_ok=True)
    thumb_dir = os.path.join(output_dir, "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)

    try:
        doc = pymupdf.open(pdf_path)
        page_count = len(doc)
        slides = []

        for i in range(page_count):
            page = doc[i]
            rect = page.rect
            width_pts = rect.width
            height_pts = rect.height

            # ---- Full-res slide for 1080p / 4K display player (High quality JPG, ~5x smaller than PNG) ----
            scale = DISPLAY_WIDTH / width_pts if width_pts > 0 else 2.0
            scale = min(max(scale, 1.0), 3.0)
            mat = pymupdf.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            filename = f"slide_{i + 1}.jpg"
            out_file = os.path.join(output_dir, filename)
            pix.save(out_file, output="jpg", jpg_quality=92)

            # ---- Fast thumbnail for admin preview grid (480px wide, ~20 KB) ----
            thumb_scale = THUMB_WIDTH / width_pts if width_pts > 0 else 0.5
            thumb_mat = pymupdf.Matrix(thumb_scale, thumb_scale)
            thumb_pix = page.get_pixmap(matrix=thumb_mat, alpha=False)

            thumb_filename = f"slide_{i + 1}.jpg"
            thumb_file = os.path.join(thumb_dir, thumb_filename)
            thumb_pix.save(thumb_file, output="jpg", jpg_quality=82)

            slides.append({
                "slide_index": i + 1,
                "filename": filename,
                "thumb_filename": f"thumbs/{thumb_filename}",
                "width": pix.width,
                "height": pix.height,
                "thumb_width": thumb_pix.width,
                "thumb_height": thumb_pix.height
            })

        doc.close()
        return {
            "success": True,
            "page_count": page_count,
            "slides": slides
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python render_pdf.py <pdf_path> <output_dir>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    result = render_pdf(pdf_path, output_dir)
    print(json.dumps(result))
