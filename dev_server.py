"""로컬 미리보기용 정적 서버. 브라우저가 JS 모듈을 캐싱해 수정 사항이
반영되지 않는 문제를 막기 위해 모든 응답에 no-cache 헤더를 붙인다."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
    http.server.test(HandlerClass=NoCacheHandler, port=port)
