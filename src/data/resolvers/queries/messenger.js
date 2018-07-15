import { Integrations, Conversations, Messages, Users } from '../../../db/models';
import {
  isOnline as isStaffsOnline,
  unreadMessagesSelector,
  unreadMessagesQuery,
} from '../utils/messenger';

export default {
  getMessengerIntegration(root, args) {
    return Integrations.getIntegration(args.brandCode, 'messenger');
  },

  conversations(root, { integrationId, customerId }) {
    return Conversations.find({
      integrationId,
      customerId,
    }).sort({ createdAt: -1 });
  },

  conversationDetail(root, { _id }) {
    return Conversations.findOne({ _id });
  },

  messages(root, { conversationId }) {
    return Messages.find({
      conversationId,
      internal: false,
    }).sort({ createdAt: 1 });
  },

  async messengerSupporters(root, { integrationId }) {
    const integration = await Integrations.findOne({ _id: integrationId });
    const messengerData = integration.messengerData || {};

    return Users.find({ _id: { $in: messengerData.supporterIds || [] } });
  },

  unreadCount(root, { conversationId }) {
    return Messages.count({
      conversationId,
      ...unreadMessagesSelector,
    });
  },

  totalUnreadCount(root, args) {
    const { integrationId, customerId } = args;

    // find conversations
    return Conversations.find({
      integrationId,
      customerId,

      // find read messages count
    }).then(convs => Messages.count(unreadMessagesQuery(convs)));
  },

  isMessengerOnline(root, args) {
    return Integrations.findOne({ _id: args.integrationId }).then(integration => {
      const { availabilityMethod, isOnline, onlineHours } = integration.messengerData || {};
      const modifiedIntegration = Object.assign({}, integration, {
        availabilityMethod,
        isOnline,
        onlineHours,
      });

      return isStaffsOnline(modifiedIntegration);
    });
  },
};
