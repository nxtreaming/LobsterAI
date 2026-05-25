import { describe, expect, test } from 'vitest';

import {
  dedupeArtifactsForDisplay,
  hasToolResultMediaAssets,
  normalizeFilePathForDedup,
  parseFileLinksFromMessage,
  parseFilePathsFromText, parseLocalServiceUrlsFromText, parseMediaTokensFromText,
  parseToolArtifact,
  parseToolResultMediaArtifacts,
} from './artifactParser';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged (except lowercase)', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches: file:// derived path vs tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });

  test('dedup matches file URL and local POSIX path', () => {
    const fromFileUrl = 'file:///Users/admin/work/test0522/generated-video.mp4';
    const fromTool = '/Users/admin/work/test0522/generated-video.mp4';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });
});

describe('parseFileLinksFromMessage', () => {
  test('strips leading / from Windows file:// link path', () => {
    const content = '文件：[hello.pptx](file:///D:/workspace/hello.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/hello.pptx');
  });

  test('preserves Unix file:// link path', () => {
    const content = '[report.pdf](file:///home/user/report.pdf)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/home/user/report.pdf');
  });

  test('handles URI-encoded paths', () => {
    const content = '[文件.pptx](file:///D:/my%20folder/%E6%96%87%E4%BB%B6.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/my folder/文件.pptx');
  });

  test('creates image artifacts for local file links', () => {
    const content = '[generated-image.png](file:///home/user/project/generated-image.png)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.png');
  });

  test('creates video artifacts for local file links', () => {
    const content = '[generated-video.mp4](file:///home/user/project/generated-video.mp4)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('video');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-video.mp4');
  });
});

describe('parseFilePathsFromText', () => {
  test('strips leading / after file:/// protocol removal on Windows', () => {
    const content = 'output at file:///D:/project/output.pdf done';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/project/output.pdf');
  });

  test('creates image artifacts for bare local image paths', () => {
    const content = 'Saved generated image: /home/user/project/generated-image.webp';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.webp');
  });

  test('creates video artifacts for bare local video paths', () => {
    const content = 'Saved generated video: /home/user/project/generated-video.webm';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('video');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-video.webm');
  });
});

describe('parseToolResultMediaArtifacts', () => {
  test('prefers local filePath for persisted generated images', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'system' as const,
      content: 'Saved generated image',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'image',
              url: 'https://example.com/generated.png?signature=temporary',
              filePath: '/home/user/project/generated-image.png',
              mimeType: 'image/png',
              filename: 'generated-image.png',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].content).toBe('');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.png');
  });

  test('uses remote url when no local file path exists', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'Generated image',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'image',
              url: 'https://example.com/generated.png?signature=temporary',
              mimeType: 'image/png',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].content).toBe('https://example.com/generated.png?signature=temporary');
    expect(artifacts[0].filePath).toBeUndefined();
  });

  test('skips remote-only video assets because video preview requires a local file', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'Generated video',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'video',
              url: 'https://example.com/generated.mp4?signature=temporary',
              mimeType: 'video/mp4',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(0);
    expect(hasToolResultMediaAssets(toolResultMsg)).toBe(false);
  });

  test('prefers local filePath for persisted generated videos', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'system' as const,
      content: 'Saved generated video',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'video',
              url: 'https://example.com/generated.mp4?signature=temporary',
              filePath: '/home/user/project/generated-video.mp4',
              mimeType: 'video/mp4',
              filename: 'generated-video.mp4',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('video');
    expect(artifacts[0].content).toBe('');
    expect(artifacts[0].remoteUrl).toBe('https://example.com/generated.mp4?signature=temporary');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-video.mp4');
  });

  test('detects media assets in tool result metadata', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'system' as const,
      content: 'Saved generated video',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'video',
              url: 'https://example.com/generated.mp4',
              filePath: '/home/user/project/generated-video.mp4',
            },
          ],
        },
      },
    };

    expect(hasToolResultMediaAssets(toolResultMsg)).toBe(true);
  });
});

describe('dedupeArtifactsForDisplay', () => {
  test('keeps one artifact when a generated video has both file link and metadata records', () => {
    const linkArtifacts = parseFileLinksFromMessage(
      '[generated-video.mp4](file:///home/user/project/generated-video.mp4)',
      'result1',
      'sess1',
    );
    const metadataArtifacts = parseToolResultMediaArtifacts({
      id: 'result1',
      type: 'system' as const,
      content: 'Saved generated video',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'video',
              url: 'https://example.com/generated.mp4?signature=temporary',
              filePath: '/home/user/project/generated-video.mp4',
              mimeType: 'video/mp4',
              filename: 'generated-video.mp4',
            },
          ],
        },
      },
    }, 'sess1');

    const artifacts = dedupeArtifactsForDisplay([...linkArtifacts, ...metadataArtifacts]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe(metadataArtifacts[0].id);
    expect(artifacts[0].remoteUrl).toBe('https://example.com/generated.mp4?signature=temporary');
  });

  test('replaces remote media artifact with local persisted version sharing the same url', () => {
    const artifacts = dedupeArtifactsForDisplay([
      {
        id: 'remote',
        messageId: 'msg1',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: 'https://example.com/generated.mp4',
        fileName: 'generated-video.mp4',
        createdAt: 1,
      },
      {
        id: 'local',
        messageId: 'msg1',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: '',
        fileName: 'generated-video.mp4',
        filePath: '/home/user/project/generated-video.mp4',
        remoteUrl: 'https://example.com/generated.mp4',
        createdAt: 2,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('local');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-video.mp4');
  });

  test('does not replace local media artifact with later remote placeholder', () => {
    const artifacts = dedupeArtifactsForDisplay([
      {
        id: 'local',
        messageId: 'msg1',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: '',
        fileName: 'generated-video.mp4',
        filePath: '/home/user/project/generated-video.mp4',
        remoteUrl: 'https://example.com/generated.mp4',
        createdAt: 1,
      },
      {
        id: 'remote',
        messageId: 'msg1',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: 'https://example.com/generated.mp4',
        fileName: 'generated-video.mp4',
        createdAt: 2,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('local');
  });

  test('dedupes video artifacts with file URL and local path forms', () => {
    const artifacts = dedupeArtifactsForDisplay([
      {
        id: 'file-url',
        messageId: 'msg1',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: '',
        fileName: 'generated-video.mp4',
        filePath: 'file:///Users/admin/work/test0522/generated-video.mp4',
        createdAt: 1,
      },
      {
        id: 'local',
        messageId: 'msg2',
        sessionId: 'sess1',
        type: 'video',
        title: 'generated-video.mp4',
        content: '',
        fileName: 'generated-video.mp4',
        filePath: '/Users/admin/work/test0522/generated-video.mp4',
        createdAt: 2,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('local');
  });
});

describe('parseLocalServiceUrlsFromText', () => {
  test('parses localhost service URLs', () => {
    const content = '服务已启动：http://localhost:4173/login-react.html';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('local-service');
    expect(artifacts[0].url).toBe('http://localhost:4173/login-react.html');
    expect(artifacts[0].title).toBe('login-react.html');
  });

  test('uses markdown link text as title', () => {
    const content = '[登录页面](http://localhost:4173/login-react.html)';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('登录页面');
  });

  test('deduplicates repeated markdown and bare URLs', () => {
    const content = '[http://localhost:4173/](http://localhost:4173/)\nhttp://localhost:4173/';
    const artifacts = parseLocalServiceUrlsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
  });

  test('ignores remote URLs', () => {
    const artifacts = parseLocalServiceUrlsFromText('https://example.com/app', 'msg1', 'sess1');
    expect(artifacts).toHaveLength(0);
  });
});

describe('parseMediaTokensFromText', () => {
  test('parses MEDIA token with Windows path (no space)', () => {
    const content = 'MEDIA:C:\\Users\\test\\images\\output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('C:\\Users\\test\\images\\output.png');
    expect(artifacts[0].type).toBe('image');
  });

  test('parses MEDIA token with space after colon', () => {
    const content = 'MEDIA: /tmp/output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/output.png');
  });

  test('parses macOS path with spaces (Application Support)', () => {
    const content = 'MEDIA: /Users/test/Library/Application Support/com.lobsterai/images/output.png';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/Library/Application Support/com.lobsterai/images/output.png');
    expect(artifacts[0].type).toBe('image');
  });

  test('parses backtick-wrapped path with spaces', () => {
    const content = 'MEDIA: `/Users/test/Library/Application Support/output.png`';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/Library/Application Support/output.png');
  });

  test('parses file:// prefixed MEDIA path', () => {
    const content = 'MEDIA: file:///D:/workspace/image.jpg';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/image.jpg');
  });

  test('parses MEDIA token with video path', () => {
    const content = 'MEDIA: /tmp/output.mp4';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/output.mp4');
    expect(artifacts[0].type).toBe('video');
  });

  test('parses multiple MEDIA tokens on separate lines', () => {
    const content = 'MEDIA: /tmp/img1.png\nMEDIA: /tmp/img2.jpg';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].filePath).toBe('/tmp/img1.png');
    expect(artifacts[1].filePath).toBe('/tmp/img2.jpg');
  });

  test('ignores MEDIA token with unknown extension', () => {
    const content = 'MEDIA: /tmp/data.xyz';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(0);
  });

  test('trims trailing whitespace from path', () => {
    const content = 'MEDIA: /tmp/output.png   ';
    const artifacts = parseMediaTokensFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/tmp/output.png');
  });
});

describe('parseToolArtifact', () => {
  test('extracts file path from Write tool input', () => {
    const toolUseMsg = {
      id: 'tool1',
      type: 'tool_use' as const,
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Write',
        toolUseId: 'tu1',
        toolInput: { file_path: 'D:\\workspace\\hello.html', content: '<html></html>' },
      },
    };
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'OK',
      timestamp: Date.now(),
      metadata: { toolUseId: 'tu1' },
    };
    const artifact = parseToolArtifact(toolUseMsg, toolResultMsg, 'sess1');
    expect(artifact).not.toBeNull();
    expect(artifact!.filePath).toBe('D:\\workspace\\hello.html');
  });

  test('dedup: tool path and file link path normalize to same value', () => {
    const toolPath = 'D:\\new_ws_test_2\\hello-slide.pptx';
    const linkContent = '[hello-slide.pptx](file:///D:/new_ws_test_2/hello-slide.pptx)';
    const linkArtifacts = parseFileLinksFromMessage(linkContent, 'msg1', 'sess1');
    expect(linkArtifacts).toHaveLength(1);

    expect(normalizeFilePathForDedup(toolPath))
      .toBe(normalizeFilePathForDedup(linkArtifacts[0].filePath!));
  });
});
