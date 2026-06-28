export type BlockReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  audioAsVoice?: boolean;
  isReasoning?: boolean;
  replyToId?: string;
  replyToTag?: boolean;
  replyToCurrent?: boolean;
  assistantArtifactDelivery?: boolean;
  assistantArtifact?: {
    caption?: string;
    deliveryId?: string;
  };
};
