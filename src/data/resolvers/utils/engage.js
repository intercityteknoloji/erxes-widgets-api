import requestify from 'requestify';

import { Users, Integrations, EngageMessages, Conversations, Messages } from '../../../db/models';

/*
 * replaces customer & user infos in given content
 * @return String
 */
export const replaceKeys = ({ content, customer, user }) => {
  let result = content;

  // replace customer fields
  result = result.replace(/{{\s?customer.name\s?}}/gi, customer.name);
  result = result.replace(/{{\s?customer.email\s?}}/gi, customer.email);

  // replace user fields
  result = result.replace(/{{\s?user.fullName\s?}}/gi, user.fullName);
  result = result.replace(/{{\s?user.position\s?}}/gi, user.position);
  result = result.replace(/{{\s?user.email\s?}}/gi, user.email);

  return result;
};

/*
 * returns requested user's ip address
 */
const getIP = async remoteAddress => {
  if (process.env.NODE_ENV === 'production') {
    return remoteAddress;
  }

  const res = await requestify.get('https://jsonip.com');

  return JSON.parse(res.body).ip;
};

/*
 * returns requested user's geolocation info
 */
const getLocationInfo = async remoteAddress => {
  // Don't do anything in test mode
  if (process.env.NODE_ENV === 'test') {
    return {
      city: 'Ulaanbaatar',
      country: 'Mongolia',
    };
  }

  const ip = await getIP(remoteAddress);
  const response = await requestify.get(`http://ipinfo.io/${ip}/json`);
  const data = JSON.parse(response.body);

  return {
    city: data.city,
    country: data.country,
  };
};

/*
 * checks individual rule
 * @return boolean
 */
export const checkRule = ({ rule, browserInfo, numberOfVisits, city, country }) => {
  const { language, url } = browserInfo;
  const { kind, condition } = rule;
  const ruleValue = rule.value;

  let valueToTest;

  if (kind === 'browserLanguage') {
    valueToTest = language;
  }

  if (kind === 'currentPageUrl') {
    valueToTest = url;
  }

  if (kind === 'city') {
    valueToTest = city;
  }

  if (kind === 'country') {
    valueToTest = country;
  }

  if (kind === 'numberOfVisits') {
    valueToTest = numberOfVisits;
  }

  // is
  if (condition === 'is' && valueToTest !== ruleValue) {
    return false;
  }

  // isNot
  if (condition === 'isNot' && valueToTest === ruleValue) {
    return false;
  }

  // isUnknown
  if (condition === 'isUnknown' && valueToTest) {
    return false;
  }

  // hasAnyValue
  if (condition === 'hasAnyValue' && !valueToTest) {
    return false;
  }

  // startsWith
  if (condition === 'startsWith' && !valueToTest.startsWith(ruleValue)) {
    return false;
  }

  // endsWith
  if (condition === 'endsWith' && !valueToTest.endsWith(ruleValue)) {
    return false;
  }

  // greaterThan
  if (condition === 'greaterThan' && valueToTest < ruleValue) {
    return false;
  }

  // lessThan
  if (condition === 'lessThan' && valueToTest > ruleValue) {
    return false;
  }

  return true;
};

/*
 * this function determines whether or not current visitor's information
 * satisfying given engage message's rules
 * @return Promise
 */
export const checkRules = async ({ rules, browserInfo, numberOfVisits, remoteAddress }) => {
  // get country, city info
  const { city, country } = await getLocationInfo(remoteAddress);

  let passedAllRules = true;

  rules.forEach(rule => {
    // check individual rule
    if (!checkRule({ rule, browserInfo, city, country, numberOfVisits })) {
      passedAllRules = false;
      return;
    }
  });

  return passedAllRules;
};

/*
 * Creates conversation & message object using given info
 * @return Promise
 */
export const createConversation = async ({ customer, integration, user, engageData }) => {
  // replace keys in content
  const replacedContent = replaceKeys({
    content: engageData.content,
    customer: customer,
    user,
  });

  // create conversation
  const conversation = await Conversations.createConversation({
    userId: user._id,
    customerId: customer._id,
    integrationId: integration._id,
    content: replacedContent,
  });

  // create message
  const message = await Messages.createMessage({
    engageData,
    conversationId: conversation._id,
    userId: user._id,
    customerId: customer._id,
    content: replacedContent,
  });

  return {
    message,
    conversation,
  };
};

/*
 * this function will be used in messagerConnect and it will create conversations
 * when visitor messenger connect * @return Promise
 */
export const createEngageVisitorMessages = async params => {
  const { brandCode, customer, browserInfo, remoteAddress } = params;

  const { brand, integration } = await Integrations.getIntegration(brandCode, 'messenger', true);

  // find engage messages
  const messengerData = integration.messengerData || {};

  // if integration configured as hide conversations
  // then do not create any engage messages
  if (messengerData.hideConversationList) {
    return [];
  }

  const messages = await EngageMessages.find({
    'messenger.brandId': brand._id,
    kind: 'visitorAuto',
    method: 'messenger',
    isLive: true,
    customerIds: { $nin: [customer._id] },
  });

  for (let message of messages) {
    const user = await Users.findOne({ _id: message.fromUserId });

    // check for rules
    const isPassedAllRules = await checkRules({
      rules: message.messenger.rules,
      browserInfo,
      remoteAddress,
      numberOfVisits: customer.messengerData.sessionCount || 0,
    });

    // if given visitor is matched with given condition then create
    // conversations
    if (isPassedAllRules) {
      await createConversation({
        customer,
        integration,
        user,
        engageData: {
          ...message.messenger,
          messageId: message._id,
          fromUserId: message.fromUserId,
        },
      });

      // add given customer to customerIds list
      await EngageMessages.update(
        { _id: message._id },
        { $push: { customerIds: customer._id } },
        {},
        () => {},
      );
    }
  }
};
