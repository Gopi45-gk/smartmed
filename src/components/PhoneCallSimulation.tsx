import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Medicine, TranslationStrings, Language, PatientProfile } from '../types';
import { Phone, PhoneOff, Mic, MicOff, CheckCircle, Volume2, ShieldCheck, Clock, Sparkles, AlertCircle } from 'lucide-react';
import { soundManager } from '../utils/audio';
import { sttProvider, ttsProvider } from '../utils/speech';
import {
  sendVoiceMessageToLocalAI,
  isAIServerReachable,
  appendTurnToSharedHistory,
  loadConversationHistory,
  type AIMessage,
} from '../utils/aiClient';
import confetti from 'canvas-confetti';

interface Props {
  close: () => void;
  medicines: Medicine[];
  setMedicines: Dispatch<SetStateAction<Medicine[]>>;
  t: TranslationStrings;
  lang: Language;
  patientProfile?: PatientProfile;
}

type CallState = 'incoming' | 'connected' | 'responded';
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
type VoicePromptType = 'GREETING' | 'TAKEN_ACK' | 'DELAY_ACK' | 'SKIP_ACK' | 'FAREWELL' | 'EMERGENCY' | 'CLARIFY' | 'MAX_CLARIFY';
type MedicationIntent = 'EMERGENCY' | 'FAREWELL' | 'TAKEN' | 'NOT_TAKEN' | 'DELAYED' | 'SKIPPED' | 'CLINICAL_QUERY' | 'UNCLEAR';

// ─── Voice Script Generator (User Registered Data Only - No Hallucinations) ──
function buildVoiceScript(
  type: VoicePromptType,
  patientName: string,
  lang: Language,
  medicineName?: string,
): string {
  const pName = patientName.trim();
  const med = medicineName?.trim();

  switch (type) {
    case 'GREETING':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா` : 'ஐயா';
        const medStr = med ? `உங்கள் ${med} மருந்தை` : 'உங்கள் மருந்தை';
        return `வணக்கம் ${pStr}! நலமாக இருக்கிறீர்களா? இப்போது ${medStr} எடுத்துக்கொள்ளும் நேரம். மருந்தை எடுத்துக்கொண்டீர்களா?`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी` : 'जी';
        const medStr = med ? `आपकी ${med} दवा` : 'आपकी दवा';
        return `नमस्ते ${pStr}! आप कैसे हैं? अभी ${medStr} लेने का समय हो गया है। क्या आपने पानी के साथ अपनी दवा ले ली है?`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు` : 'గారు';
        const medStr = med ? `మీ ${med} మందు` : 'మీ మందు';
        return `నమస్కారం ${pStr}! బాగున్నారా? ఇప్పుడు ${medStr} వేసుకునే సమయం. మీరు మందు తీసుకున్నారా?`;
      } else if (lang === 'kn') {
        const pStr = pName ? `${pName} ಅವರೇ` : 'ಅವರೇ';
        const medStr = med ? `ನಿಮ್ಮ ${med} ಔಷಧಿ` : 'ನಿಮ್ಮ ಔಷಧಿ';
        return `ನಮಸ್ಕಾರ ${pStr}! ಹೇಗಿದ್ದೀರಿ? ಈಗ ${medStr} ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ. ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ?`;
      } else if (lang === 'ml') {
        const pStr = pName ? `${pName} ചേട്ടാ` : 'ചേട്ടാ';
        const medStr = med ? `നിങ്ങളുടെ ${med} മരുന്ന്` : 'നിങ്ങളുടെ മരുന്ന്';
        return `നമസ്കാരം ${pStr}! സുഖമാണോ? ഇപ്പോൾ ${medStr} കഴിക്കാനുള്ള സമയമാണ്. മരുന്ന് കഴിച്ചോ?`;
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName} মশাই` : '';
        const medStr = med ? `আপনার ${med} ওষুধ` : 'আপনার ওষুধ';
        return `নমস্কার ${pStr}! কেমন আছেন? এখন ${medStr} খাওয়ার সময় হয়েছে। আপনি কি ওষুধটি খেয়েছেন?`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName} जी` : '';
        const medStr = med ? `आपले ${med} औषध` : 'आपले औषध';
        return `नमस्कार ${pStr}! आपण कसे आहात? आता ${medStr} घेण्याची वेळ झाली आहे. आपण औषध घेतले आहे का?`;
      } else {
        const pStr = pName ? pName : 'there';
        const medStr = med ? `your ${med}` : 'your medication';
        return `Hello ${pStr}! I hope you're having a good day. It is time for ${medStr}. Have you had a chance to take it with some water yet?`;
      }

    case 'TAKEN_ACK':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா` : 'ஐயா';
        const medStr = med ? `உங்கள் ${med} மருந்தை` : 'மருந்தை';
        return `ரொம்ப மகிழ்ச்சி ${pStr}! ${medStr} சரியான நேரத்தில் எடுத்துக்கொண்டீர்கள். அதை நான் குறித்துக் கொண்டேன். உடம்பை நல்லா பாத்துக்கோங்க! வேறு ஏதேனும் சந்தேகம் இருக்கிறதா?`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी` : 'जी';
        const medStr = med ? `अपनी ${med} दवा` : 'दवा';
        return `बहुत अच्छा ${pStr}! आपने समय पर ${medStr} ले ली है। मैंने इसे दर्ज कर लिया है। पर्याप्त पानी पिएं। क्या आप कुछ और पूछना चाहते हैं?`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు` : 'గారు';
        const medStr = med ? `${med} మందు` : 'మందు';
        return `చాలా సంతోషం ${pStr}! మీరు సమయానికి ${medStr} తీసుకున్నారు. నేను నమోదు చేశాను. మంచి నీరు త్రాగండి. ఇంకా ఏమైనా సందేహం ఉందా?`;
      } else if (lang === 'kn') {
        const pStr = pName ? `${pName} ಅವರೇ` : 'ಅವರೇ';
        return `ತುಂಬಾ ಸಂತೋಷ ${pStr}! ನೀವು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ. ನಾನು ದಾಖಲಿಸಿದ್ದೇನೆ. ಆರೋಗ್ಯವಾಗಿರಿ!`;
      } else if (lang === 'ml') {
        const pStr = pName ? `${pName} ചേട്ടാ` : 'ചേട്ടാ';
        return `വളരെ സന്തോഷം ${pStr}! കൃത്യസമയത്ത് മരുന്ന് കഴിച്ചതിൽ സന്തോഷം. ഞാൻ രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ഇപ്പോൾ എങ്ങനെയുണ്ട്?`;
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}` : '';
        const medStr = med ? `আপনার ${med} ওষুধ` : 'ওষুধ';
        return `খুব ভালো ${pStr}! আপনি সময়মতো ${medStr} খেয়েছেন। আমি তা লিপিবদ্ধ করেছি। পর্যাপ্ত জল পান করুন। আর কোনো প্রশ্ন আছে কি?`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}` : '';
        const medStr = med ? `आपले ${med} औषध` : 'औषध';
        return `खूप छान ${pStr}! आपण वेळेवर ${medStr} घेतले आहे. मी नोंद केली आहे. भरपूर पाणी प्या. आणखी काही विचारायचे आहे का?`;
      } else {
        const pStr = pName ? pName : 'friend';
        const medStr = med ? `your ${med}` : 'your medicine';
        return `Wonderful, ${pStr}! I'm so glad you've taken ${medStr} on time. I have marked it in your record. Please drink some water to stay hydrated. How are you feeling right now?`;
      }

    case 'DELAY_ACK':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா` : 'ஐயா';
        return `பரவாயில்லைங்க ${pStr}, பொறுமையாக சாப்பிட்டு முடியுங்கள். இன்னும் பதினைந்து நிமிடங்களில் நான் மீண்டும் நினைவூட்டுகிறேன். கவலைப்படாதீர்கள்!`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी` : 'जी';
        return `कोई बात नहीं ${pStr}, आप आराम से भोजन करें। मैं 15 मिनट बाद दोबारा याद दिलाऊंगा। अपना ख्याल रखें!`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు` : 'గారు';
        return `ఏమీ పర్వాలేదు ${pStr}, ప్రశాంతంగా భోజనం చేయండి. నేను 15 నిమిషాల తర్వాత మళ్లీ గుర్తుచేస్తాను!`;
      } else if (lang === 'kn') {
        const pStr = pName ? `${pName} ಅವರೇ` : 'ಅವರೇ';
        return `ಏನೂ ತೊಂದರೆಯಿಲ್ಲ ${pStr}, ನಿಧಾನವಾಗಿ ಊಟ ಮುಗಿಸಿ. ನಾನು 15 ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ನೆನಪಿಸುತ್ತೇನೆ!`;
      } else if (lang === 'ml') {
        const pStr = pName ? `${pName} ചേട്ടാ` : 'ചേട്ടാ';
        return `ഒരു കുഴപ്പവുമില്ല ${pStr}, സാവധാനം ഭക്ഷണം കഴിക്കുക. 15 മിനിറ്റിനു ശേഷം ഞാൻ വീണ്ടും ഓർമ്മിപ്പിക്കാം!`;
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}` : '';
        return `ঠিক আছে ${pStr}। আমি আপনাকে ১৫ মিনিট পরে আবার মনে করিয়ে দেব। ওষুধ নিতে ভুলবেন না!`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}` : '';
        return `ठीक आहे ${pStr}। मी आपल्याला १५ मिनिटांनी पुन्हा आठवण करून देईन. औषध वेळेवर घ्यायला विसरू नका!`;
      } else {
        const pStr = pName ? pName : 'friend';
        return `No problem at all, ${pStr}! Please take your time, and I will remind you again in 15 minutes. Take good care!`;
      }

    case 'SKIP_ACK':
      if (lang === 'ta') {
        return 'சரிங்க ஐயா, இந்த முறை மருந்தை தவிர்த்ததாகக் குறித்துக்கொள்கிறேன். அடுத்த முறை இரட்டை மாத்திரை எடுக்காதீர்கள், ஏதேனும் அசௌகரியம் இருந்தால் மருத்துவரை தொடர்பு கொள்ளவும்.';
      } else if (lang === 'hi') {
        return 'समझ गया। इस खुराक को छूटा हुआ दर्ज किया गया है। अगली बार दोहरी खुराक न लें, और तबियत ठीक न लगे तो डॉक्टर से बात करें।';
      } else if (lang === 'te') {
        return 'అర్థమైంది, ఈ మోతాదు తీసుకోలేదని నమోదు చేశాను. తదుపరి సారి డబుల్ డోస్ తీసుకోవద్దు, ఏదైనా సమస్య ఉంటే వైద్యుడిని సంప్రదించండి.';
      } else if (lang === 'kn') {
        return 'ಅರ್ಥವಾಯಿತು, ಈ ಡೋಸ್ ತೆಗೆದುಕೊಳ್ಳಲಾಗಿಲ್ಲ ಎಂದು ನಮೂದಿಸಲಾಗಿದೆ. ಮುಂದಿನ ಬಾರಿ ಡಬಲ್ ಡೋಸ್ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ.';
      } else if (lang === 'ml') {
        return 'മനസ്സിലായി, ഈ ഡോസ് ഒഴിവാക്കിയതായി രേഖപ്പെടുത്തി. അടുത്ത തവണ ഇരട്ടി ഡോസ് കഴിക്കരുത്.';
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}` : '';
        return `বুঝেছি ${pStr}। এই ডোজটি বাদ দেওয়া হয়েছে বলে চিহ্নিত করলাম। কোনো সমস্যা বা অস্বস্তি হলে চিকিৎসককে জানান।`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}` : '';
        return `समजले ${pStr}। हा डोस वगळल्याचे नोंदवले आहे. काही त्रास जाणवल्यास कृपया डॉक्टरांशी संपर्क साधा.`;
      } else {
        return 'I understand. I have recorded this dose as skipped. Please remember never to take a double dose next time, and do contact your doctor if you feel unwell.';
      }

    case 'FAREWELL':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா` : 'ஐயா';
        return `கேட்கவே மிக்க மகிழ்ச்சியாக இருக்கிறது ${pStr}! உடம்பை நன்றாகப் பார்த்துக் கொள்ளுங்கள். இனிய நாளாக அமையட்டும். வணக்கம்!`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी` : 'जी';
        return `यह सुनकर बहुत अच्छा लगा ${pStr}! अपना ख्याल रखें और आपका दिन शुभ हो। नमस्ते!`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు` : 'గారు';
        return `ఇది విని చాలా ఆనందంగా ఉంది ${pStr}! జాగ్రత్తగా ఉండండి, మంచి రోజు కావాలని కోరుకుంటున్నాను. నమస్కారం!`;
      } else if (lang === 'kn') {
        return 'ತುಂಬಾ ಸಂತೋಷ! ನಿಮ್ಮ ಆರೋಗ್ಯವನ್ನು ಚೆನ್ನಾಗಿ ನೋಡಿಕೊಳ್ಳಿ. ನಮಸ್ಕಾರ!';
      } else if (lang === 'ml') {
        return 'വളരെ സന്തോഷം! ആരോഗ്യം ശ്രദ്ധിക്കുക. നല്ലൊരു ദിവസം ആശംസിക്കുന്നു. നമസ്കാരം!';
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}` : '';
        return `শুনে খুব আনন্দ হলো ${pStr}! নিজের যত্ন নেবেন এবং আপনার দিনটি শুভ হোক। নমস্কার!`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}` : '';
        return `ऐकून खूप आनंद झाला ${pStr}! आपली काळजी घ्या आणि आपला दिवस चांगला जावो. नमस्कार!`;
      } else {
        const pStr = pName ? pName : 'friend';
        return `That is wonderful to hear, ${pStr}! You take care and have a blessed, healthy day. Feel free to reach out anytime. Goodbye!`;
      }

    case 'EMERGENCY':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா, ` : '';
        return `${pStr}நெஞ்சு வலி மற்றும் மூச்சுத் திணறல் தீவிரமான அவசர நிலை. உடனே உட்கார்ந்து அமைதியாக இருங்கள், உடனடியாக அவசர மருத்துவ சேவையை அல்லது ஆம்புலன்ஸை அழையுங்கள்!`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी, ` : '';
        return `${pStr}सीने में दर्द और सांस लेने में कठिनाई गंभीर आपातकाल है। कृपया तुरंत बैठ जाएं और एम्बुलेंस या आपातकालीन सेवा को कॉल करें!`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు, ` : '';
        return `${pStr}ఛాతీ నొప్పి మరియు శ్వాసలో ఇబ్బంది తీవ్రమైన అత్యవసర పరిస్థితి. వెంటనే కూర్చోండి మరియు అత్యవసర వైద్య సహాయం పొందండి!`;
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}, ` : '';
        return `${pStr}বুকে তীব্র ব্যথা এবং শ্বাসকষ্ট একটি জরুরি অবস্থা। অবিলম্বে বসে পড়ুন এবং জরুরি সেবা বা অ্যাম্বুলেন্সকে কল করুন!`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}, ` : '';
        return `${pStr}छातीत दुखणे आणि श्वास घेण्यास त्रास ही गंभीर आणीबाणी आहे. कृपया त्वरित बसा आणि रुग्णवाहिकेला कॉल करा!`;
      } else {
        const pStr = pName ? `${pName}, ` : '';
        return `${pStr}chest pain and difficulty breathing are medical emergencies. Please sit down immediately, remain calm, and call emergency services or an ambulance right away!`;
      }

    case 'CLARIFY':
      if (lang === 'ta') {
        const pStr = pName ? `${pName} ஐயா` : 'ஐயா';
        return `மன்னிக்கவும் ${pStr}, எனக்கு சரியாக கேட்கவில்லை. உங்கள் மருந்தை எடுத்துக்கொண்டீர்களா அல்லது ஏதேனும் சந்தேகம் இருக்கிறதா?`;
      } else if (lang === 'hi') {
        const pStr = pName ? `${pName} जी` : 'जी';
        return `क्षमा करें ${pStr}, मैं सुन नहीं पाया। क्या आपने अपनी दवा ले ली है या कोई स्वास्थ्य संबंधी प्रश्न है?`;
      } else if (lang === 'te') {
        const pStr = pName ? `${pName} గారు` : 'గారు';
        return `క్షమించండి ${pStr}, స్పష్టంగా వినిపించలేదు. మీరు మందు తీసుకున్నారా లేదా ఏదైనా ప్రశ్న ఉందా?`;
      } else if (lang === 'kn') {
        return 'ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ?';
      } else if (lang === 'ml') {
        return 'ക്ഷമിക്കണം, വ്യക്തമായില്ല. നിങ്ങൾ മരുന്ന് കഴിച്ചോ?';
      } else if (lang === 'bn') {
        const pStr = pName ? `${pName}` : '';
        return `ক্ষমা করবেন ${pStr}, আমি ঠিক শুনতে পাইনি। আপনি কি ওষুধ খেয়েছেন নাকি কোনো প্রশ্ন আছে?`;
      } else if (lang === 'mr') {
        const pStr = pName ? `${pName}` : '';
        return `माफ करा ${pStr}, मला नीट ऐकू आले नाही. आपण औषध घेतले आहे की काही अडचण आहे?`;
      } else {
        const pStr = pName ? pName : 'friend';
        return `I didn't quite catch that, ${pStr}. Could you please repeat if you have taken your medicine or if you need any advice?`;
      }

    case 'MAX_CLARIFY':
      if (lang === 'ta') return 'உங்கள் பதிலை உறுதிப்படுத்த முடியவில்லை. திரையில் உள்ள பொத்தான்களைப் பயன்படுத்தி உறுதிப்படுத்தவும்.';
      if (lang === 'hi') return 'दवा लेने की पुष्टि नहीं हो सकी। कृपया स्क्रीन पर दिए गए बटन का उपयोग करें।';
      if (lang === 'te') return 'స్పష్టత రాలేదు. దయచేసి స్క్రీన్‌పై ఉన్న బటன்లను ఉపయోగించండి.';
      if (lang === 'kn') return 'ಖಚಿತಪಡಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರದೆಯ ಮೇಲಿನ ಬಟನ್ ಬಳಸಿ.';
      if (lang === 'ml') return 'സ്ഥിರീകരിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി സ്ക്രീനിലെ ബട്ടണുകൾ ഉപയോഗിക്കുക.';
      if (lang === 'bn') return 'আপনার উত্তর নিশ্চিত করা যায়নি। অনুগ্রহ করে স্ক্রিনের বোতাম ব্যবহার করুন।';
      if (lang === 'mr') return 'औषध घेतल्याची पुष्टी झाली नाही. कृपया स्क्रीनवरील बटण वापरा.';
      return 'I could not confirm your response. Please use the buttons on your screen to confirm.';
  }
}

function classifyVoiceIntent(spokenText: string): MedicationIntent {
  const lower = spokenText.toLowerCase().trim();
  const tokens = lower.split(/[\s,?.!]+/);

  // 1. Emergency detection
  const emergencyKeywords = [
    'chest pain', 'heart attack', 'heart racing', 'cannot breathe', 'cant breathe', "can't breathe",
    'trouble breathing', 'stroke', 'fainted', 'bleeding heavily', 'emergency',
    'நெஞ்சு வலி', 'மூச்சு', 'மாரடைப்பு', 'சீने में दर्द', 'सांस', 'ఛాతీ నొప్పి', 'శ్వాస',
    'നെഞ്ചുവേദന', 'ശ്വാസം', 'ಎದೆ ನೋವು', 'ಉಸಿರಾಟ'
  ,
    'বুকে ব্যথা', 'শ্বাসকষ্ট', 'অ্যাম্বুলেন্স', 'छातीत दुखणे', 'हार्ट'
  ];
  if (emergencyKeywords.some(kw => lower.includes(kw))) {
    return 'EMERGENCY';
  }

  // 2. Farewell / Patient feels fine / Polite closing
  const farewellKeywords = [
    'fine', 'feeling fine', 'feeling good', 'all good', 'no questions', 'no thank you', 'no thanks',
    'thats all', "that's all", 'bye', 'goodbye', 'have a good day', 'thank you', 'thanks',
    'நல்லா இருக்கேன்', 'நன்றாக இருக்கிறேன்', 'நன்றி', 'போதும்', 'சரி நன்றி', 'வணக்கம்',
    'ठीक हूँ', 'अच्छा हूँ', 'धन्यवाद', 'नमस्ते', 'अलविदा',
    'బాగున్నాను', 'ధన్యవాదాలు', 'నమస్కారం',
    'ಚೆನ್ನಾಗಿದ್ದೇನೆ', 'ಧನ್ಯವಾದಗಳು',
    'സുഖമാണ്', 'നന്ദി'
  ,
    'ভালো আছি', 'ধন্যবাদ', 'নমস্কার', 'ঠিক আছি',
    'छान आहे', 'धन्यवाद', 'नमस्कार', 'बाय'
  ];
  if (farewellKeywords.some(kw => lower.includes(kw))) {
    return 'FAREWELL';
  }

  // 3. Clinical & Medication Queries / Symptoms
  const queryKeywords = [
    'what', 'why', 'how', 'when', 'who', 'where', 'which', 'side effect', 'food', 'water', 'doctor',
    'fever', 'pain', 'ache', 'dizzy', 'dizziness', 'sleep', 'sleepy', 'sleepiness', 'drowsy',
    'tablet', 'medicine', 'pill', 'dose', 'dosage', 'breathe', 'breath',
    'pressure', 'bp', 'hypertension', 'serious', 'symptom', 'headache', 'eye', 'cough', 'cold',
    'stomach', 'acidity', 'gas', 'nausea', 'vomit', 'tired', 'fatigue', 'weakness',
    'miss', 'missed', 'forgot', 'safe', 'harm', 'can i', 'should i', 'is it', 'is this', 'coffee', 'tea', 'milk',
    // Tamil
    'என்ன', 'எப்படி', 'எப்போது', 'எதற்கு', 'வலி', 'சாப்பாடு', 'மருந்து', 'மாத்திரை',
    'மயக்கம்', 'தலைசுற்றல்', 'தலைச்சுற்றல்', 'தூக்கம்', 'கண்', 'தலைவலி', 'வயிறு', 'காய்ச்சல்', 'சளி', 'இருமல்',
    'இரத்த அழுத்தம்', 'ரத்த அழுத்தம்', 'மறந்து', 'முடியுமா', 'காபி', 'டீ',
    // Hindi
    'क्या', 'कैसे', 'कब', 'क्यों', 'दर्द', 'खाना', 'दवा', 'गोली', 'पेट', 'बुखार', 'खांसी', 'सर्दी',
    'चक्कर', 'नींद', 'आँख', 'सिरदर्द', 'रक्तचाप', 'भूल', 'सकता', 'कॉफी', 'चाय',
    // Telugu
    'ఏమిటి', 'ఎలా', 'ఎప్పుడు', 'ఎందుకు', 'నొప్పి', 'ఆహారం', 'మందు', 'మాత్ర', 'కడుపు', 'జ్వరం', 'దగ్గు',
    'తలతిరగడం', 'నిద్ర', 'కంటి', 'తలనొప్పి', 'రక్తపోటు', 'మర్చి', 'కాఫీ',
    // Kannada
    'ಏನು', 'ಹೇಗೆ', 'ಯಾವಾಗ', 'ಏಕೆ', 'ನೋವು', 'ಊಟ', 'ಔಷಧಿ', 'ಮಾತ್ರೆ', 'ಹೊಟ್ಟೆ', 'ಜ್ವರ',
    'ತಲೆಸುತ್ತು', 'ನಿದ್ದೆ', 'ಕಣ್ಣು', 'ತಲೆನೋವು', 'ಮರೆತು',
    // Malayalam
    'എന്ത്', 'എങ്ങനെ', 'എപ്പോൾ', 'എന്തിന്', 'വേദന', 'ഭക്ഷണം', 'മരുന്ന്', 'വയറുവേദന', 'പനി',
    'തലകറക്കം', 'ഉറക്കം', 'നെഞ്ച്', 'കണ്ണ്', 'തലവേദന', 'മറന്നു'
  ];

  // Delay / Snooze Keywords
  const delayKeywords = [
    'later', 'remind', 'snooze', '15 min', '30 min', 'after', 'busy', 'eating', 'having food',
    'பிறகு', 'நினைவூட்டு', 'அப்புறம்', 'சாப்பிடுறேன்', 'சாப்பிடுகிறேன்',
    'बाद में', 'याद', 'खाना खा रहा',
    'తర్వాత', 'గుర్తు', 'భోజనం',
    'ಆಮೇಲೆ', 'ನೆನ',
    'ಪಿന്നെ', 'ഓർമ്മി',
      'পরে', '১৫ মিনিট', 'খাবার খাচ্ছি',
    'नंतर', '१५ मिनिटे', 'जेवत आहे'
  ];

  // Negative / NOT TAKEN
  const negativeKeywords = [
    "haven't", 'havent', 'not yet', 'have not', "didn't", 'did not', 'no', 'nope',
    'not now', 'not taken', 'still not', 'wont', "won't",
    'இல்லை', 'இல்ல', 'இன்னும் எடுக்கவில்லை', 'இன்னும் இல்லை', 'இன்னும் இல்ல', 'எடுக்கல', 'சாப்பிடல', 'போடல',
    'illa', 'illai', 'edukala', 'sappidala',
    'नहीं', 'नहीं ली', 'अभी नहीं', 'nahi', 'nahi li', 'abhi nahi',
    'లేదు', 'ఇంకా తీసుకోలేదు', 'ledu', 'inka ledu',
    'ಇಲ್ಲ', 'ಇನ್ನೂ ತೆಗೆದುಕೊಂಡಿಲ್ಲ',
    'ಇಲ್ಲ', 'ಇതുവരെ കഴിച്ചಿಲ್ಲ',
      'না', 'খাইনি', 'এখনো খাইনি', 'নিইনি',
    'नाही', 'घेतले नाही', 'अजून नाही'
  ];

  // Positive / TAKEN Keywords
  const takenKeywords = [
    'took', 'already taken', 'already took', 'had my', 'finished', 'done',
    'yes', 'yeah', 'yup', 'yes i did', 'mark taken', 'swallowed', 'taken',
    'i took it', 'i have taken', 'took it',
    'எடுத்துக்கிட்டேன்', 'எடுத்துட்டேன்', 'எடுத்தாச்சு', 'சாப்பிட்டேன்', 'சாப்பிட்டாச்சு',
    'குடிச்சேன்', 'குடிச்சாச்சு', 'போட்டேன்', 'போட்டாச்சு', 'முடிஞ்சது', 'ஆம்', 'ஆமாம்',
    'eduthen', 'eduthuten', 'eduthachu', 'aamam', 'aam',
    'ले ली', 'खा ली', 'ले लिया', 'खा लिया', 'हाँ', 'हो गया', 'दवा ले ली', 'haa', 'haan',
    'తీసుకున్నాను', 'వేసుకున్నాను', 'అవును', 'అయింది', 'తీసుకున్నా', 'avunu', 'teesukunna',
    'ತಗೊಂಡೆ', 'ತೆಗೆದುಕೊಂಡೆ', 'ಹೌದು', 'ಆಯಿತು', 'haudu',
    'കഴിച്ചു', 'എടുത്തു', 'ഉവ്വ്', 'കഴിഞ്ഞു', 'athe', 'kazhichu',
      'হ্যাঁ', 'খেয়েছি', 'নিয়েছি', 'খেয়ে নিয়েছি', 'হয়ে গেছে',
    'हो', 'होय', 'घेतले', 'घेऊन झाले', 'खाल्ले'
  ];

  // Skip Keywords
  const skipKeywords = [
    'skip', 'skipped', 'missed', "won't take", 'dont want', 'refuse',
    'தவிர்த்து', 'வேண்டாம்', 'छोड़', 'వద్దు', 'ಬೇಡ', 'വേണ്ട'
  ];

  const hasQuery = queryKeywords.some(kw => lower.includes(kw));
  const hasTaken = takenKeywords.some(kw => lower.includes(kw) || tokens.includes(kw));
  const hasNegative = negativeKeywords.some(kw => lower.includes(kw) || tokens.includes(kw));
  const hasDelay = delayKeywords.some(kw => lower.includes(kw));
  const hasSkip = skipKeywords.some(kw => lower.includes(kw));

  // If patient asks about symptoms or medication details, prioritize clinical advice
  if (hasQuery) {
    return 'CLINICAL_QUERY';
  }

  if (hasDelay || (hasNegative && hasDelay)) {
    return 'DELAYED';
  }

  if (hasNegative) {
    return 'NOT_TAKEN';
  }

  if (hasSkip) {
    return 'SKIPPED';
  }

  if (hasTaken) {
    return 'TAKEN';
  }

  if (lower.includes('?') || tokens.length >= 3) {
    return 'CLINICAL_QUERY';
  }

  return 'UNCLEAR';
}

export function PhoneCallSimulation({ close, medicines, setMedicines, t, lang, patientProfile }: Props) {
  const [callState, setCallState] = useState<CallState>('connected');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [aiMessage, setAiMessage] = useState<string>('');
  const [patientReply, setPatientReply] = useState<string>('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptInterim, setTranscriptInterim] = useState<string>('');
  const [clarificationAttempts, setClarificationAttempts] = useState<number>(0);

  const isComponentMounted = useRef<boolean>(true);
  const conversationHistoryRef = useRef<AIMessage[]>([]);

  // ─── Speak AI Response via TTS (Synchronized Spoken & UI Transcript) ──────
  const speakAIResponse = useCallback((text: string, onDone?: () => void) => {
    if (!isComponentMounted.current) return;
    setVoiceState('speaking');

    ttsProvider.speak(text, {
      lang,
      rate: 1.0,
      pitch: 1.0,
      onStart: () => {
        if (isComponentMounted.current) setVoiceState('speaking');
      },
      onEnd: () => {
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        onDone?.();
      },
      onError: (err) => {
        console.warn('[PhoneCallSimulation] Speech error:', err);
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        onDone?.();
      },
    });
  }, [lang]);

  // Track component mounted state and trigger greeting immediately
  useEffect(() => {
    isComponentMounted.current = true;
    conversationHistoryRef.current = loadConversationHistory();

    // Check if local AI server is active
    isAIServerReachable().then(reachable => {
      if (isComponentMounted.current) {
        setAiAvailable(reachable);
      }
    });

    // Registered patient name and upcoming medicine from patient database ONLY
    const registeredName = patientProfile?.name?.trim() || '';
    const upcomingMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
    const greeting = buildVoiceScript('GREETING', registeredName, lang, upcomingMed?.name);

    // Exact synchronization between spoken text and UI transcript
    setAiMessage(greeting);

    const greetTimer = setTimeout(() => {
      speakAIResponse(greeting, () => {
        // After greeting finishes, automatically open microphone to listen
        if (isComponentMounted.current) {
          startListening();
        }
      });
    }, 150);

    return () => {
      isComponentMounted.current = false;
      clearTimeout(greetTimer);
      sttProvider.stopListening();
      ttsProvider.stop();
      soundManager.stopRinging();
    };
  }, []);

  // ─── Start Microphone Listening (STT) ──────────────────────────────────────
  const startListening = useCallback(() => {
    if (!isComponentMounted.current) return;
    ttsProvider.stop();
    setErrorMessage(null);
    setTranscriptInterim('');
    setVoiceState('listening');

    if (!sttProvider.isSupported()) {
      setErrorMessage('Browser microphone not supported. Please use the quick response buttons.');
      setVoiceState('idle');
      return;
    }

    sttProvider.startListening({
      lang,
      onStart: () => {
        if (isComponentMounted.current) setVoiceState('listening');
      },
      onResult: (text: string, isFinal: boolean) => {
        if (!isComponentMounted.current) return;
        setTranscriptInterim(text);

        if (isFinal && text.trim()) {
          sttProvider.stopListening();
          handleUserVoiceInput(text.trim());
        }
      },
      onError: (err: string) => {
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        if (!err.includes('No speech') && !err.includes('network') && !err.includes('aborted')) {
          setErrorMessage(err);
        }
      },
      onEnd: () => {
        if (!isComponentMounted.current) return;
        setTranscriptInterim(current => {
          if (current.trim()) {
            handleUserVoiceInput(current.trim());
          } else {
            setVoiceState(prev => prev === 'listening' ? 'idle' : prev);
          }
          return '';
        });
      },
    });
  }, [lang]);

  // ─── Process User Voice Input (Human-Like Intent Orchestration) ────────────
  const handleUserVoiceInput = async (spokenText: string) => {
    if (!spokenText.trim() || !isComponentMounted.current) return;

    setPatientReply(spokenText);
    setTranscriptInterim('');
    setVoiceState('processing');

    const registeredName = patientProfile?.name?.trim() || '';
    const upcomingMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
    const medName = upcomingMed?.name || '';
    const intent = classifyVoiceIntent(spokenText);

    // 1. Emergency Detection
    if (intent === 'EMERGENCY') {
      const emergencyMsg = buildVoiceScript('EMERGENCY', registeredName, lang, medName);
      setAiMessage(emergencyMsg);
      speakAIResponse(emergencyMsg);
      return;
    }

    // 2. Patient feels fine / Farewell / Polite wrap up
    if (intent === 'FAREWELL') {
      const farewellMsg = buildVoiceScript('FAREWELL', registeredName, lang, medName);
      setAiMessage(farewellMsg);
      speakAIResponse(farewellMsg, () => {
        if (isComponentMounted.current) {
          setCallState('responded');
        }
      });
      return;
    }

    // 3. Clinical & Medication Queries / Symptoms
    if (intent === 'CLINICAL_QUERY') {
      setClarificationAttempts(0);
      try {
        const medicinesContext = medicines.map(m => ({
          name: m.name,
          time: m.time,
          dose: m.dose,
          food: m.food,
          status: m.status,
        }));

        const result = await sendVoiceMessageToLocalAI(
          spokenText,
          conversationHistoryRef.current,
          medicinesContext,
          registeredName,
          lang
        );

        if (!isComponentMounted.current) return;

        let responseText = result.response;
        // Clean out bullet points or markdown to ensure spoken human elegance
        responseText = responseText.replace(/^[•\-\*]\s+/gm, '').replace(/\n+/g, ' ').trim();

        setAiAvailable(true);
        setAiMessage(responseText);

        appendTurnToSharedHistory(spokenText, responseText);
        conversationHistoryRef.current.push(
          { role: 'user', content: spokenText },
          { role: 'assistant', content: responseText }
        );

        speakAIResponse(responseText, () => {
          // Keep continuous two-way voice loop open
          if (isComponentMounted.current && callState === 'connected') {
            startListening();
          }
        });
        return;
      } catch (err) {
        console.warn('[PhoneCallSimulation] Voice AI query fallback:', err);
      }
    }

    // 4. Medicine Confirmed TAKEN
    if (intent === 'TAKEN') {
      setClarificationAttempts(0);
      handleMarkMedicineTaken();
      const ackMsg = buildVoiceScript('TAKEN_ACK', registeredName, lang, medName);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg, () => {
        // Continuous conversational loop: listen for patient's reply or farewell
        if (isComponentMounted.current && callState === 'connected') {
          startListening();
        }
      });
      return;
    }

    // 5. Delay / Snooze
    if (intent === 'DELAYED' || intent === 'NOT_TAKEN') {
      setClarificationAttempts(0);
      const ackMsg = buildVoiceScript('DELAY_ACK', registeredName, lang, medName);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg, () => {
        if (isComponentMounted.current && callState === 'connected') {
          startListening();
        }
      });
      return;
    }

    // 6. Skip Dose
    if (intent === 'SKIPPED') {
      setClarificationAttempts(0);
      const ackMsg = buildVoiceScript('SKIP_ACK', registeredName, lang, medName);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg, () => {
        if (isComponentMounted.current && callState === 'connected') {
          startListening();
        }
      });
      return;
    }

    // 7. Unclear Intent (Maximum 2 attempts)
    if (clarificationAttempts < 2) {
      setClarificationAttempts(prev => prev + 1);
      const clarifyPrompt = buildVoiceScript('CLARIFY', registeredName, lang, medName);
      setAiMessage(clarifyPrompt);
      speakAIResponse(clarifyPrompt, () => {
        if (isComponentMounted.current && callState === 'connected') {
          startListening();
        }
      });
    } else {
      const maxClarifyPrompt = buildVoiceScript('MAX_CLARIFY', registeredName, lang, medName);
      setAiMessage(maxClarifyPrompt);
      speakAIResponse(maxClarifyPrompt);
    }
  };

  // ─── Mark Medicine Taken Logic ─────────────────────────────────────────────
  const handleMarkMedicineTaken = () => {
    soundManager.playSuccessChime();
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.5 } });
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMedicines(prev => prev.map(m => {
      if (m.status === 'upcoming') {
        return { ...m, status: 'taken', takenAt: nowStr };
      }
      return m;
    }));
  };

  // ─── Answer Incoming Call ──────────────────────────────────────────────────
  const handleAnswerCall = () => {
    soundManager.stopRinging();
    setCallState('connected');
    ttsProvider.unlock();
    soundManager.resumeAudioContext();
    const registeredName = patientProfile?.name?.trim() || '';
    const upcomingMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
    const greeting = buildVoiceScript('GREETING', registeredName, lang, upcomingMed?.name);
    setAiMessage(greeting);
    speakAIResponse(greeting, () => {
      if (isComponentMounted.current) {
        startListening();
      }
    });
  };

  // ─── End Call (Interrupt & Reset) ──────────────────────────────────────────
  const handleEndCall = () => {
    sttProvider.stopListening();
    ttsProvider.stop();
    soundManager.stopRinging();
    close();
  };

  // ─── Mic Center Button Click (Toggle Listening / Interrupt) ────────────────
  const handleMicClick = () => {
    ttsProvider.unlock();
    soundManager.resumeAudioContext();

    if (callState !== 'connected') return;

    if (voiceState === 'speaking') {
      // User interrupts AI speech
      ttsProvider.stop();
      startListening();
    } else if (voiceState === 'listening') {
      // Stop listening and process whatever was captured
      sttProvider.stopListening();
    } else {
      // Idle or error: start listening
      startListening();
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.95 }} 
      className="fixed inset-0 bg-[#121214] text-white flex flex-col justify-between p-6 z-50 overflow-hidden font-sans"
    >
      {/* Top Bar Header */}
      <div className="text-center pt-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-gray-300 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-md">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>{t.aiVoiceAssistant}</span>
        </div>

        <h2 className="text-3xl font-extrabold mt-3 tracking-tight">
          {callState === 'incoming' ? t.incomingCall : 'SmartMed AI Care'}
        </h2>

        {/* Dynamic Voice Status Badge */}
        <p className="text-sm mt-1 flex items-center justify-center gap-1.5 font-medium">
          {callState === 'incoming' && (
            <span className="text-amber-400 animate-pulse">{t.connectingCall}</span>
          )}

          {callState === 'connected' && (
            <>
              {voiceState === 'listening' && (
                <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  Listening... Speak your question
                </span>
              )}
              {voiceState === 'processing' && (
                <span className="text-blue-400 flex items-center gap-1.5 font-semibold">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  Processing with local MNN AI...
                </span>
              )}
              {voiceState === 'speaking' && (
                <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  AI Speaking... (Tap mic to interrupt)
                </span>
              )}
              {voiceState === 'idle' && (
                <span className="text-gray-300 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Connected (Two-Way Voice) • Tap mic to speak
                </span>
              )}
              {voiceState === 'error' && (
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Microphone idle • Tap mic to retry
                </span>
              )}
            </>
          )}

          {callState === 'responded' && (
            <span className="text-blue-400 font-semibold">{t.statusUpdated}</span>
          )}
        </p>

        {/* Offline local status pill */}
        {callState === 'connected' && (
          <div className="mt-1 flex items-center justify-center">
            {aiAvailable ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Local MNN Inference Active (Offline)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                SmartMed Voice Care (Offline Engine Active)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center Phone Visual / Interactive Microphone */}
      <div className="flex flex-col items-center justify-center my-auto space-y-6">
        <div className="relative">
          {/* Animated concentric pulse rings */}
          {(callState === 'incoming' || voiceState === 'listening' || voiceState === 'speaking') && (
            <>
              <motion.div 
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                className={`absolute inset-0 rounded-full ${
                  voiceState === 'listening' ? 'bg-emerald-500/40' : 'bg-[#0071E3]/40'
                }`}
              />
              <motion.div 
                animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
                className={`absolute inset-0 rounded-full ${
                  voiceState === 'listening' ? 'bg-emerald-500/20' : 'bg-[#0071E3]/20'
                }`}
              />
            </>
          )}

          {/* Interactive Mic / Phone Action Button */}
          <button
            onClick={handleMicClick}
            disabled={callState !== 'connected'}
            aria-label={voiceState === 'speaking' ? 'Interrupt AI speech' : 'Toggle microphone'}
            className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-2xl relative z-10 transition-all active:scale-95 ${
              callState === 'connected'
                ? voiceState === 'listening'
                  ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 shadow-emerald-500/50 ring-4 ring-emerald-400/40 animate-pulse'
                  : voiceState === 'speaking'
                  ? 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40 ring-4 ring-blue-400/40'
                  : 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40 hover:brightness-110'
                : 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40'
            }`}
          >
            {callState === 'connected' ? (
              voiceState === 'listening' ? (
                <Mic className="w-12 h-12 text-white animate-pulse" />
              ) : voiceState === 'speaking' ? (
                <Volume2 className="w-12 h-12 text-white animate-bounce" />
              ) : voiceState === 'processing' ? (
                <Sparkles className="w-12 h-12 text-white animate-spin" />
              ) : (
                <Mic className="w-12 h-12 text-white" />
              )
            ) : (
              <Phone className="w-12 h-12 text-white animate-bounce" />
            )}
          </button>
        </div>

        {/* AI Speaking Speech Balloon */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/15 p-5 rounded-3xl w-full max-w-sm text-center shadow-lg">
          <div className="flex items-center justify-center gap-1.5 text-xs text-blue-300 font-bold mb-1.5">
            <Volume2 className={`w-4 h-4 ${voiceState === 'speaking' ? 'animate-bounce text-emerald-400' : ''}`} />
            <span>AI Speaking (Natural Voice):</span>
          </div>

          <p className="text-sm font-medium text-gray-100 leading-relaxed min-h-[40px]">
            {aiMessage}
          </p>

          {/* Audio Waveform visualization (animates only when speaking) */}
          <div className="flex items-center justify-center gap-1 mt-3.5 h-6">
            {[40, 75, 100, 60, 90, 45, 80, 50, 70].map((h, i) => (
              <motion.span
                key={i}
                animate={voiceState === 'speaking' ? { height: [`${h * 0.2}%`, `${h}%`, `${h * 0.3}%`] } : { height: '18%' }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.08 }}
                className={`w-1 rounded-full transition-all ${
                  voiceState === 'speaking' ? 'bg-[#34C759]' : 'bg-gray-600'
                }`}
                style={{ height: `${voiceState === 'speaking' ? h : 18}%` }}
              />
            ))}
          </div>
        </div>

        {/* Interim / Live Speech Recognition Preview */}
        {transcriptInterim && (
          <div className="bg-blue-500/20 text-blue-200 px-4 py-2 rounded-xl text-xs max-w-sm text-center border border-blue-400/30 animate-pulse">
            <span className="font-semibold text-blue-300">Hearing: </span>
            <span>"{transcriptInterim}"</span>
          </div>
        )}

        {/* Patient Speech Response Card */}
        {(callState === 'responded' || patientReply) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-500/20 text-emerald-300 p-4 rounded-2xl w-full max-w-sm text-center border border-emerald-500/40 shadow-lg"
          >
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">{t.patientRepliedLabel}:</p>
            <p className="text-sm font-bold mt-1 text-white">{patientReply}</p>
            <div className="flex items-center justify-center gap-1.5 text-xs mt-2 text-emerald-300 font-semibold">
              <CheckCircle className="w-4 h-4" />
              <span>{t.statusUpdated}</span>
            </div>
          </motion.div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="bg-red-500/20 text-red-300 px-4 py-2 rounded-xl text-xs max-w-sm text-center border border-red-500/30">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Call Interaction Controls */}
      <div className="pb-6 w-full max-w-sm mx-auto">
        {callState === 'incoming' && (
          <div className="flex items-center justify-around">
            <button 
              onClick={handleEndCall}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg active:scale-90 transition-transform">
                <PhoneOff className="w-7 h-7" />
              </div>
              <span className="text-xs font-medium text-gray-300">Decline</span>
            </button>

            <button 
              onClick={handleAnswerCall}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/40 active:scale-90 transition-transform">
                <Phone className="w-7 h-7" />
              </div>
              <span className="text-xs font-medium text-gray-300">Answer</span>
            </button>
          </div>
        )}

        {(callState === 'connected' || callState === 'responded') && (
          <div className="w-full space-y-3">
            {/* Quick Touch/Voice Responses (Works Offline & Online) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  ttsProvider.stop();
                  handleUserVoiceInput(t.replyTaken || "I took my medicine");
                }}
                className="py-2.5 px-3 bg-white/10 hover:bg-white/15 active:scale-95 border border-white/20 rounded-xl text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="truncate">{t.replyTaken || "I took my medicine"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  ttsProvider.stop();
                  handleUserVoiceInput(t.replySnooze || "Remind me in 15 mins");
                }}
                className="py-2.5 px-3 bg-white/10 hover:bg-white/15 active:scale-95 border border-white/20 rounded-xl text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="truncate">{t.replySnooze || "Remind in 15m"}</span>
              </button>
            </div>

            <button 
              onClick={handleEndCall} 
              className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-lg shadow-red-500/30 active:scale-98 transition-all flex items-center justify-center gap-2 text-sm"
            >
              <PhoneOff className="w-5 h-5" />
              <span>{t.endCall}</span>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
