import { v4 } from 'uuid';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilState, useResetRecoilState, useSetRecoilState } from 'recoil';
import {
  QueryKeys,
  parseCompactConvo,
  getResponseSender,
  useGetMessagesByConvoId,
} from 'librechat-data-provider';
import type {
  TMessage,
  TSubmission,
  TEndpointOption,
  TConversation,
  TGetConversationsResponse,
} from 'librechat-data-provider';
import type { TAskFunction, ExtendedFile } from '~/common';
import { useAuthContext } from './AuthContext';
import useNewConvo from './useNewConvo';
import useUserKey from './useUserKey';
import store from '~/store';

// this to be set somewhere else
export default function useChatHelpers(index = 0, paramId) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthContext();
  // const tempConvo = {
  //   endpoint: null,
  //   conversationId: null,
  //   jailbreak: false,
  //   examples: [],
  //   tools: [],
  // };

  const { newConversation } = useNewConvo(index);
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(index);
  const { conversationId, endpoint } = conversation ?? {};

  const queryParam = paramId === 'new' ? paramId : conversationId ?? paramId ?? '';

  // if (!queryParam && paramId && paramId !== 'new') {

  // }

  /* Messages: here simply to fetch, don't export and use `getMessages()` instead */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: _messages } = useGetMessagesByConvoId(conversationId ?? '', {
    enabled: isAuthenticated,
  });

  const resetLatestMessage = useResetRecoilState(store.latestMessageFamily(index));
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(index));
  const [latestMessage, setLatestMessage] = useRecoilState(store.latestMessageFamily(index));
  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(latestMessage?.parentMessageId ?? null),
  );

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, queryParam], messages);
    },
    // [conversationId, queryClient],
    [queryParam, queryClient],
  );

  const addConvo = useCallback(
    (convo: TConversation) => {
      const convoData = queryClient.getQueryData<TGetConversationsResponse>([
        QueryKeys.allConversations,
        { pageNumber: '1', active: true },
      ]) ?? { conversations: [] as TConversation[], pageNumber: '1', pages: 1, pageSize: 14 };

      let { conversations: convos, pageSize = 14 } = convoData;
      pageSize = Number(pageSize);
      convos = convos.filter((c) => c.conversationId !== convo.conversationId);
      convos = convos.length < pageSize ? convos : convos.slice(0, -1);

      const conversations = [
        {
          ...convo,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...convos,
      ];

      queryClient.setQueryData<TGetConversationsResponse>(
        [QueryKeys.allConversations, { pageNumber: '1', active: true }],
        {
          ...convoData,
          conversations,
        },
      );
    },
    [queryClient],
  );

  // const getConvos = useCallback(() => {
  //   return queryClient.getQueryData<TGetConversationsResponse>([QueryKeys.allConversations, { pageNumber: '1', active: true }]);
  // }, [queryClient]);

  const invalidateConvos = useCallback(() => {
    queryClient.invalidateQueries([QueryKeys.allConversations, { active: true }]);
  }, [queryClient]);

  const getMessages = useCallback(() => {
    return queryClient.getQueryData<TMessage[]>([QueryKeys.messages, queryParam]);
  }, [queryParam, queryClient]);

  /* Conversation */
  // const setActiveConvos = useSetRecoilState(store.activeConversations);

  // const setConversation = useCallback(
  //   (convoUpdate: TConversation) => {
  //     _setConversation(prev => {
  //       const { conversationId: convoId } = prev ?? { conversationId: null };
  //       const { conversationId: currentId } = convoUpdate;
  //       if (currentId && convoId && convoId !== 'new' && convoId !== currentId) {
  //         // for now, we delete the prev convoId from activeConversations
  //         const newActiveConvos = { [currentId]: true };
  //         setActiveConvos(newActiveConvos);
  //       }
  //       return convoUpdate;
  //     });
  //   },
  //   [_setConversation, setActiveConvos],
  // );
  const { getExpiry } = useUserKey(endpoint ?? '');
  const setSubmission = useSetRecoilState(store.submissionByIndex(index));

  const ask: TAskFunction = (
    { text, parentMessageId = null, conversationId = null, messageId = null },
    {
      editedText = null,
      editedMessageId = null,
      isRegenerate = false,
      isContinued = false,
      isEdited = false,
    } = {},
  ) => {
    if (!!isSubmitting || text === '') {
      return;
    }

    if (endpoint === null) {
      console.error('No endpoint available');
      return;
    }

    conversationId = conversationId ?? conversation?.conversationId ?? null;
    if (conversationId == 'search') {
      console.error('cannot send any message under search view!');
      return;
    }

    if (isContinued && !latestMessage) {
      console.error('cannot continue AI message without latestMessage!');
      return;
    }

    const isEditOrContinue = isEdited || isContinued;

    // set the endpoint option
    const convo = parseCompactConvo(endpoint, conversation ?? {});
    const endpointOption = {
      ...convo,
      endpoint,
      key: getExpiry(),
    } as TEndpointOption;
    const responseSender = getResponseSender(endpointOption);

    let currentMessages: TMessage[] | null = getMessages() ?? [];

    // construct the query message
    // this is not a real messageId, it is used as placeholder before real messageId returned
    text = text.trim();
    const fakeMessageId = v4();
    parentMessageId =
      parentMessageId || latestMessage?.messageId || '00000000-0000-0000-0000-000000000000';

    if (conversationId == 'new') {
      parentMessageId = '00000000-0000-0000-0000-000000000000';
      currentMessages = [];
      conversationId = null;
    }
    const currentMsg: TMessage = {
      text,
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId,
      conversationId,
      messageId: isContinued && messageId ? messageId : fakeMessageId,
      error: false,
    };

    // construct the placeholder response message
    const generation = editedText ?? latestMessage?.text ?? '';
    const responseText = isEditOrContinue
      ? generation
      : '<span className="result-streaming">█</span>';

    const responseMessageId = editedMessageId ?? latestMessage?.messageId ?? null;
    const initialResponse: TMessage = {
      sender: responseSender,
      text: responseText,
      parentMessageId: isRegenerate ? messageId : fakeMessageId,
      messageId: responseMessageId ?? `${isRegenerate ? messageId : fakeMessageId}_`,
      conversationId,
      unfinished: false,
      submitting: true,
      isCreatedByUser: false,
      isEdited: isEditOrContinue,
      error: false,
    };

    if (isContinued) {
      currentMessages = currentMessages.filter((msg) => msg.messageId !== responseMessageId);
    }

    const submission: TSubmission = {
      conversation: {
        ...conversation,
        conversationId,
      },
      endpointOption,
      message: {
        ...currentMsg,
        generation,
        responseMessageId,
        overrideParentMessageId: isRegenerate ? messageId : null,
      },
      messages: currentMessages,
      isEdited: isEditOrContinue,
      isContinued,
      isRegenerate,
      initialResponse,
    };

    if (isRegenerate) {
      setMessages([...submission.messages, initialResponse]);
    } else {
      setMessages([...submission.messages, currentMsg, initialResponse]);
    }
    setLatestMessage(initialResponse);
    setSubmission(submission);
  };

  const regenerate = ({ parentMessageId }) => {
    const messages = getMessages();
    const parentMessage = messages?.find((element) => element.messageId == parentMessageId);

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isRegenerate: true });
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found or not created by user.',
      );
    }
  };

  const continueGeneration = () => {
    if (!latestMessage) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();

    const parentMessage = messages?.find(
      (element) => element.messageId == latestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found, or not created by user.',
      );
    }
  };

  const stopGenerating = () => {
    setSubmission(null);
  };

  const handleStopGenerating = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopGenerating();
  };

  const handleRegenerate = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const parentMessageId = latestMessage?.parentMessageId;
    if (!parentMessageId) {
      console.error('Failed to regenerate the message: parentMessageId not found.');
      return;
    }
    regenerate({ parentMessageId });
  };

  const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    continueGeneration();
    setSiblingIdx(0);
  };

  const [showBingToneSetting, setShowBingToneSetting] = useRecoilState(
    store.showBingToneSettingFamily(index),
  );
  const [showPopover, setShowPopover] = useRecoilState(store.showPopoverFamily(index));
  const [abortScroll, setAbortScroll] = useRecoilState(store.abortScrollFamily(index));
  const [autoScroll, setAutoScroll] = useRecoilState(store.autoScrollFamily(index));
  const [preset, setPreset] = useRecoilState(store.presetByIndex(index));
  const [textareaHeight, setTextareaHeight] = useRecoilState(store.textareaHeightFamily(index));
  const [optionSettings, setOptionSettings] = useRecoilState(store.optionSettingsFamily(index));
  const [showAgentSettings, setShowAgentSettings] = useRecoilState(
    store.showAgentSettingsFamily(index),
  );

  const [files, setFiles] = useState<ExtendedFile[]>([]);

  return {
    newConversation,
    conversation,
    setConversation,
    addConvo,
    // getConvos,
    // setConvos,
    isSubmitting,
    setIsSubmitting,
    getMessages,
    setMessages,
    setSiblingIdx,
    latestMessage,
    setLatestMessage,
    resetLatestMessage,
    ask,
    index,
    regenerate,
    stopGenerating,
    handleStopGenerating,
    handleRegenerate,
    handleContinue,
    showPopover,
    setShowPopover,
    abortScroll,
    setAbortScroll,
    autoScroll,
    setAutoScroll,
    showBingToneSetting,
    setShowBingToneSetting,
    preset,
    setPreset,
    optionSettings,
    setOptionSettings,
    showAgentSettings,
    setShowAgentSettings,
    textareaHeight,
    setTextareaHeight,
    files,
    setFiles,
    invalidateConvos,
  };
}
