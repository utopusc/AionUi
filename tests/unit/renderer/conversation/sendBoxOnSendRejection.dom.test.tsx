/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for iOfficeAI/AionUi#4242 — SendBox onSend rejection path.
 *
 * The SendBox clears the composer optimistically before awaiting onSend().
 * - onSend() resolving `false` restores the message (existing behavior).
 * - onSend() rejecting used to swallow the error and lose the prompt; it now
 *   restores the submitted message only when the composer is still in the
 *   post-send empty state, and never overwrites newer text typed while the
 *   send was pending.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-onsend-rejection-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';

const SendBoxHarness = ({ onSend, initialValue = 'submitted prompt' }: { onSend: (m: string) => Promise<void | false>; initialValue?: string }) => {
  const [value, setValue] = useState(initialValue);
  return <SendBox value={value} onChange={setValue} onSend={onSend} />;
};

describe('SendBox onSend rejection recovery (#4242)', () => {
  it('successful send keeps the composer cleared', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<SendBoxHarness onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('submitted prompt');
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('false result restores the submitted prompt (unchanged behavior)', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<SendBoxHarness onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('submitted prompt'));
  });

  it('rejected send restores the submitted prompt', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('network failure'));
    render(<SendBoxHarness onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('submitted prompt'));
  });

  it('rejected send does not overwrite newer text typed while pending', async () => {
    let rejectSend!: (e: Error) => void;
    const sendPromise = new Promise<void | false>((_, reject) => {
      rejectSend = reject;
    });
    const onSend = vi.fn().mockReturnValue(sendPromise);
    render(<SendBoxHarness onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(textarea.value).toBe('');
    // User types new text while the send is pending.
    fireEvent.change(textarea, { target: { value: 'newer user input' } });
    act(() => {
      rejectSend(new Error('late failure'));
    });
    await waitFor(() => expect(textarea.value).toBe('newer user input'));
  });
});
