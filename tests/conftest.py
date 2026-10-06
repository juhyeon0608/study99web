import pymupdf
import pytest

SAMPLE = {
    "title": "Attention Is All You Need",
    "authors": [{"given": "Ashish", "family": "Vaswani"}, {"given": "Noam", "family": "Shazeer"},
                {"given": "Niki", "family": "Parmar"}],
    "year": 2017,
    "venue": "Advances in Neural Information Processing Systems",
    "volume": "30",
    "pages": "5998-6008",
    "doi": "10.48550/arxiv.1706.03762",
    "item_type": "conference",
    "abstract": "The dominant sequence transduction models are based on complex recurrent networks.",
}


def make_pdf(title: str = "Deep Residual Learning for Image Recognition",
             body: str = "We present a residual learning framework.", doi: str = "10.1109/cvpr.2016.90",
             pages: int = 2) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        if i == 0:
            page.insert_text((72, 90), title, fontsize=20)
            page.insert_text((72, 130), "Kaiming He, Xiangyu Zhang", fontsize=11)
            if doi:
                page.insert_text((72, 150), f"DOI: {doi}", fontsize=9)
            page.insert_text((72, 200), body, fontsize=10)
        else:
            page.insert_text((72, 90), f"Page {i + 1}: shortcut connections ease optimization.", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def sample():
    return dict(SAMPLE)
