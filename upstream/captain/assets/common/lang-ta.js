/*
 * TAMIL, KEYED BY THE ENGLISH IT REPLACES.
 *
 * Read by assets/common/i18n.js, which swaps a line only when the WHOLE
 * trimmed text matches a key here. That is what keeps dish names, table
 * numbers and prices out of it: they are not in this file, and a whole-text
 * match cannot half-translate a line.
 *
 * HOW THESE ARE WRITTEN. The words a waiter uses on the floor, not the words a
 * dictionary prefers. Half the restaurant vocabulary in Tamil Nadu is spoken
 * in English anyway - "order", "table", "bill", "menu" - and a waiter reading
 * a screen mid-service should meet the word they would say out loud. Where the
 * English word is the one in use, it stays in Tamil script rather than being
 * replaced by a formal coinage nobody says: பில், ஆர்டர், டேபிள்.
 *
 * A missing sentence shows English, so this file can grow a line at a time and
 * is never wrong, only incomplete.
 *
 * NEEDS A NATIVE READ before it goes near a floor. It is written by somebody
 * who can write Tamil, not by somebody who has waited tables in Chennai, and
 * the difference shows in exactly the places that matter: how short a button
 * has to be, and which English words are better left alone.
 */

(function (root) {
  'use strict';

  const TAMIL = {
    /* ---------------------------------------------------------- the basics */
    Close: 'மூடு',
    Cancel: 'ரத்து',
    /* A dish that has run out, said by the waiter who heard it. */
    'It has run out': 'தீர்ந்துவிட்டது',
    'This phone is not on any network': 'இந்த போன் எந்த நெட்வொர்க்கிலும் இல்லை',
    'The till is turning this phone away': 'பில்லிங் கணினி இந்த போனை ஏற்கவில்லை',
    'The till is on and answering, so the Wi-Fi is fine. The shop has probably run out of handset slots. Free one on the till, or add a slot, then press Try now.':
      'பில்லிங் கணினி இயங்குகிறது, எனவே Wi-Fi சரியாக உள்ளது. கடையில் ஹேண்ட்செட் இடங்கள் தீர்ந்திருக்கலாம். பில்லிங்கில் ஒன்றை விடுவிக்கவும் அல்லது புதிதாக சேர்க்கவும், பிறகு Try now அழுத்தவும்.',
    'Enter your PIN': 'உங்கள் PIN ஐ உள்ளிடவும்',
    'Lock this phone': 'இந்த போனை பூட்டு',
    'Choose a 4 digit PIN': '4 இலக்க PIN ஐ தேர்ந்தெடுக்கவும்',
    'Enter it again': 'மீண்டும் உள்ளிடவும்',
    'Use my password instead': 'அதற்கு பதிலாக என் கடவுச்சொல்லை பயன்படுத்து',
    'Not now': 'இப்போது வேண்டாம்',
    'Those did not match. Start again.': 'இரண்டும் பொருந்தவில்லை. மீண்டும் தொடங்குங்கள்.',
    'Too many tries. Sign in with your password.': 'அதிக முறை தவறானது. கடவுச்சொல்லுடன் உள்நுழையவும்.',
    'Sign in with your password.': 'கடவுச்சொல்லுடன் உள்நுழையவும்.',
    'Wi-Fi and mobile data are both off, so nothing can reach the till. Turn Wi-Fi on and join the shop network, and this will connect by itself.':
      'Wi-Fi மற்றும் மொபைல் டேட்டா இரண்டும் அணைந்துள்ளன, எனவே பில்லிங் கணினியை அடைய முடியாது. Wi-Fi ஐ ஆன் செய்து கடை நெட்வொர்க்கில் இணையுங்கள், தானாக இணைந்துவிடும்.',
    'Add an item that is not on the menu': 'மெனுவில் இல்லாத ஐட்டத்தை சேர்',
    'Type the name first, then press +': 'முதலில் பெயரை தட்டச்சு செய்து + அழுத்தவும்',
    'Put back on': 'மீண்டும் சேர்',
    'Takes it off the menu for the rest of today. Nobody can order it, and tomorrow it comes back by itself.':
      'இன்றைக்கு மெனுவில் இருந்து நீக்கும். யாரும் ஆர்டர் செய்ய முடியாது, நாளை தானாக திரும்பி வரும்.',
    'This is off the menu today. Put it back and the floor can order it again straight away.':
      'இது இன்று மெனுவில் இல்லை. மீண்டும் சேர்த்தால் உடனே ஆர்டர் செய்யலாம்.',
    Clear: 'அழி',
    Done: 'முடிந்தது',
    Apply: 'பயன்படுத்து',
    Refresh: 'புதுப்பி',
    Back: 'பின்செல்',
    Other: 'வேறு',
    'Other...': 'வேறு...',
    Dismiss: 'விலக்கு',
    Error: 'பிழை',
    'Loading...': 'ஏற்றுகிறது...',
    'Something went wrong.': 'ஏதோ தவறாகிவிட்டது.',
    Please: 'தயவுசெய்து',
    'contact your administrator': 'உங்கள் நிர்வாகியை தொடர்பு கொள்ளுங்கள்',

    /* ------------------------------------------------------------- the menu */
    Menu: 'மெனு',
    'Search the menu': 'மெனுவில் தேடு',
    'Back to the menu': 'மெனுவுக்கு திரும்பு',
    Notes: 'குறிப்பு',
    'Item Notes': 'உணவு குறிப்பு',
    'Product Notes': 'உணவு குறிப்பு',
    'Eg: Non sugar, half milk, extra hot...': 'எ.கா: சர்க்கரை இல்லை, பாதி பால், சூடாக...',
    'On this table': 'இந்த டேபிளில்',
    'You added lately': 'நீங்கள் சமீபத்தில் சேர்த்தவை',
    'Selling today': 'இன்று விற்பவை',
    Bestseller: 'அதிகம் விற்பது',
    'Sold out': 'தீர்ந்துவிட்டது',
    "Today's price": 'இன்றைய விலை',
    'Number card': 'எண் அட்டை',
    'The number to type in Add item.': 'உணவு சேர்க்கும்போது இந்த எண்ணை தட்டச்சு செய்யவும்.',

    /* ------------------------------------------------------------ the order */
    'New order': 'புதிய ஆர்டர்',
    'Order History': 'ஆர்டர் வரலாறு',
    'Order history': 'ஆர்டர் வரலாறு',
    'Order Type': 'ஆர்டர் வகை',
    'Modify order': 'ஆர்டரை மாற்று',
    'On this order': 'இந்த ஆர்டரில்',
    'Add something': 'ஏதாவது சேர்',
    'Add to the order': 'ஆர்டரில் சேர்',
    'Update the order': 'ஆர்டரை புதுப்பி',
    'Leave it as it was': 'இருந்தபடியே விடு',
    'Back to the order': 'ஆர்டருக்கு திரும்பு',
    'Place Order': 'ஆர்டர் செய்',
    'Send to kitchen': 'சமையலறைக்கு அனுப்பு',
    'Cancel Order': 'ஆர்டரை ரத்து செய்',
    'Cancel order': 'ஆர்டரை ரத்து செய்',
    'Yes, Cancel': 'ஆம், ரத்து செய்',
    'Are you sure you want to cancel the order?': 'ஆர்டரை ரத்து செய்ய வேண்டுமா?',
    'Remove Item': 'உணவை நீக்கு',
    'Yes, Remove': 'ஆம், நீக்கு',
    'Are you sure you want to remove this item from the order?':
      'இந்த உணவை ஆர்டரிலிருந்து நீக்க வேண்டுமா?',
    Modify: 'மாற்று',
    Added: 'சேர்க்கப்பட்டது',
    Only: 'மட்டும்',

    /* ------------------------------------------------------------ the floor */
    Table: 'டேபிள்',
    'Select Table': 'டேபிளை தேர்ந்தெடு',
    'Enter Table Number': 'டேபிள் எண்ணை உள்ளிடு',
    'Loading tables...': 'டேபிள்கள் ஏற்றப்படுகின்றன...',
    'No tables set up yet.': 'இன்னும் டேபிள்கள் அமைக்கப்படவில்லை.',
    'This table is full': 'இந்த டேபிள் நிரம்பியுள்ளது',
    'Restaurant is turned off for this shop.': 'இந்த கடைக்கு restaurant முறை அணைக்கப்பட்டுள்ளது.',
    'Dine-in': 'உள்ளே சாப்பிட',
    'Take away': 'பார்சல்',
    Pax: 'நபர்கள்',
    person: 'நபர்',
    'No. of persons': 'நபர்கள் எண்ணிக்கை',
    'One more': 'ஒன்று கூட்டு',
    'One fewer': 'ஒன்று குறை',

    /* ------------------------------------------- moving an order's table */
    'Move table': 'டேபிள் மாற்று',
    'Move to another table': 'வேறு டேபிளுக்கு மாற்று',
    'Choose a table': 'ஒரு டேபிளை தேர்ந்தெடு',
    'here now': 'இப்போது இங்கே',
    'has an order': 'ஆர்டர் உள்ளது',
    'Not on a table yet': 'இன்னும் டேபிளில் இல்லை',
    'No tables configured. Whoever set up the till adds them.':
      'டேபிள்கள் அமைக்கப்படவில்லை. பில்லிங் அமைத்தவர் சேர்க்க வேண்டும்.',

    /* ------------------------------------------------------------- the bill */
    Bill: 'பில்',
    'Bill Summary': 'பில் விவரம்',
    'Cart Summary': 'கார்ட் விவரம்',
    'Cart is empty': 'கார்ட் காலியாக உள்ளது',
    Discount: 'தள்ளுபடி',
    'Discount Description': 'தள்ளுபடி விவரம்',
    'Reason for discount (optional)': 'தள்ளுபடிக்கான காரணம் (விருப்பம்)',
    'Bill asked for': 'பில் கேட்கப்பட்டது',
    'Asking...': 'கேட்கிறது...',
    'Cancelling...': 'ரத்து செய்கிறது...',

    /* --------------------------------------------------- the shop and setup */
    Captain: 'Captain',
    Login: 'உள்நுழை',
    'Change shop server': 'கடை சர்வரை மாற்று',
    'Change branch': 'கிளையை மாற்று',
    'Connect to your shop': 'உங்கள் கடையுடன் இணை',
    'Not connected yet': 'இன்னும் இணைக்கப்படவில்லை',
    'How this phone should connect': 'இந்த போன் எப்படி இணைய வேண்டும்',
    Automatically: 'தானாக',
    'In the shop': 'கடையில்',
    'Only in the shop': 'கடையில் மட்டும்',
    'Only over the internet': 'இணையம் வழியாக மட்டும்',
    'Never uses the internet. Orders stop outside the shop Wi-Fi.':
      'இணையத்தை பயன்படுத்தாது. கடை Wi-Fi இல்லாதபோது ஆர்டர் நிற்கும்.',
    'Shop Wi-Fi only. Fastest, and keeps printing when the internet is down. Orders stop outside the shop Wi-Fi.':
      'கடை Wi-Fi மட்டும். வேகமானது, இணையம் இல்லாதபோதும் பிரிண்ட் ஆகும். கடை Wi-Fi இல்லாதபோது ஆர்டர் நிற்கும்.',
    'Shop Wi-Fi when it is there, because it is faster and works with the internet down. The internet when it is not. Best for everyone.':
      'கடை Wi-Fi இருக்கும்போது அது, ஏனெனில் வேகமானது, இணையம் இல்லாதபோதும் வேலை செய்யும். இல்லாதபோது இணையம். அனைவருக்கும் சிறந்தது.',
    'For a phone already on the shop Wi-Fi. This is the fast one, and it needs no internet.':
      'ஏற்கனவே கடை Wi-Fi இல் உள்ள போனுக்கு. இதுதான் வேகமானது, இணையம் தேவையில்லை.',
    'Find the till on this Wi-Fi': 'இந்த Wi-Fi இல் பில்லிங் கணினியை கண்டுபிடி',
    'Point at the code by the till.': 'பில்லிங் அருகே உள்ள QR குறியீட்டை காட்டுங்கள்.',
    'That code is not a Posnic shop. Keep looking.':
      'அது Posnic கடையின் குறியீடு அல்ல. மீண்டும் முயலுங்கள்.',
    'Access Denied': 'அனுமதி இல்லை',
    'You are not authorized to view this page.': 'இந்த பக்கத்தை பார்க்க உங்களுக்கு அனுமதி இல்லை.',
    'Go to Home': 'முகப்புக்கு செல்',
    'Copies of a printed bill': 'அச்சிடும் பில் நகல்கள்',
    'As the shop is set': 'கடை அமைப்பின்படி',
    'Number card for the wall': 'சுவரில் ஒட்டும் எண் அட்டை',

    /* ------------------------------------- when two phones meet one order */
    'Somebody else changed this order. Showing you the latest.':
      'வேறு யாரோ இந்த ஆர்டரை மாற்றிவிட்டார்கள். சமீபத்தியதை காட்டுகிறோம்.',

    /* --------------------------------------------------- a table calling */
    'Table is calling': 'டேபிள் கூப்பிடுகிறது',
    'On my way': 'வருகிறேன்',

    /* -------------------------------------------- what the gap tool found */

    /*
     * The second pass. `npm run tamil` reads every sentence in the markup and
     * names the ones still in English; these are what it found. What is left
     * in English after this is left deliberately: a counter a script rewrites
     * the moment a screen opens ("0 items"), a line of sample text, a page
     * title nobody sees inside the app, and the word English itself.
     */

    /* getting on to the shop */
    'Scan the shop code': 'கடை குறியீட்டை ஸ்கேன் செய்',
    'Point at the code by the till. Nothing to type.':
      'பில்லிங் அருகே உள்ள குறியீட்டை காட்டுங்கள். எதுவும் தட்டச்சு செய்ய வேண்டாம்.',
    'For a phone already on the shop network.': 'ஏற்கனவே கடை நெட்வொர்க்கில் உள்ள போனுக்கு.',
    'Type the address': 'முகவரியை தட்டச்சு செய்',
    'A shop code, a web address, or the till on this Wi-Fi.':
      'கடை குறியீடு, இணைய முகவரி, அல்லது இந்த Wi-Fi இல் உள்ள பில்லிங் கணினி.',
    'Shop code, web address, or till address': 'கடை குறியீடு, இணைய முகவரி, அல்லது பில்லிங் முகவரி',
    Connect: 'இணை',
    'Looking for your till on this Wi-Fi…': 'இந்த Wi-Fi இல் பில்லிங் கணினியை தேடுகிறது…',
    'Checking…': 'சரிபார்க்கிறது…',
    'Change how it connects': 'இணைப்பு முறையை மாற்று',
    'Never uses the shop Wi-Fi. Slower, and stops when the internet does.':
      'கடை Wi-Fi ஐ பயன்படுத்தாது. மெதுவாக இருக்கும், இணையம் இல்லாதபோது நிற்கும்.',
    'Internet only. Slower to print, and stops when the internet does.':
      'இணையம் மட்டும். பிரிண்ட் மெதுவாக இருக்கும், இணையம் இல்லாதபோது நிற்கும்.',
    'In the shop · Wi-Fi, faster': 'கடையில் · Wi-Fi, வேகமானது',
    'Anywhere · internet, slower': 'எங்கிருந்தும் · இணையம், மெதுவானது',
    'not found yet': 'இன்னும் கிடைக்கவில்லை',
    'not set': 'அமைக்கப்படவில்லை',
    Find: 'தேடு',
    Anywhere: 'எங்கிருந்தும்',
    Change: 'மாற்று',
    'Choose another way': 'வேறு வழியை தேர்ந்தெடு',
    'Quick dine‑in & takeaway ordering': 'விரைவான உள்ளே சாப்பிட & பார்சல் ஆர்டர்',

    /* signing in */
    'Welcome back': 'மீண்டும் வருக',
    'Username / Email': 'பயனர் பெயர் / மின்னஞ்சல்',
    Password: 'கடவுச்சொல்',
    'Enter your username': 'உங்கள் பயனர் பெயரை உள்ளிடுங்கள்',
    'Enter your password': 'உங்கள் கடவுச்சொல்லை உள்ளிடுங்கள்',
    Continue: 'தொடர்',
    Logout: 'வெளியேறு',
    'Select Branch': 'கிளையை தேர்ந்தெடு',
    'Choose a branch to start taking orders.': 'ஆர்டர் எடுக்க ஒரு கிளையை தேர்ந்தெடுங்கள்.',
    'Your shop': 'உங்கள் கடை',
    'This shop': 'இந்த கடை',
    'Server Settings': 'சர்வர் அமைப்புகள்',
    'Changing shop signs you out and clears the menu and tables cached for this one.':
      'கடையை மாற்றினால் வெளியேற்றப்படுவீர்கள்; இந்த கடையின் மெனுவும் டேபிள்களும் அழிக்கப்படும்.',
    Language: 'மொழி',
    'What this phone shows. Dish names stay as the shop typed them. This phone only.':
      'இந்த போன் காட்டும் மொழி. உணவு பெயர்கள் கடை எழுதியபடியே இருக்கும். இந்த போனுக்கு மட்டும்.',
    /* the quick sale mark, the same one the till uses */
    'Quick sale - something the menu does not have':
      'விரைவு விற்பனை - மெனுவில் இல்லாத ஒன்று',

    /* signing out */
    'Signed in': 'உள்நுழைந்துள்ளது',
    'Sign out': 'வெளியேறு',
    'Signed in on this phone': 'இந்த போனில் உள்நுழைந்துள்ளது',
    "Signing out clears this phone's menu, tables and cart, and asks for the shop password next time.":
      'வெளியேறினால் இந்த போனின் மெனு, டேபிள்கள், கார்ட் அழிக்கப்படும், அடுத்த முறை கடை கடவுச்சொல் கேட்கப்படும்.',

    /* the page for everything that is not an order */
    Off: 'அணைந்துள்ளது',
    On: 'இயங்குகிறது',
    'Loading.': 'ஏற்றப்படுகிறது.',

    Me: 'નான்',
    Account: 'கணக்கு',
    'This phone': 'இந்த போன்',
    About: 'பற்றி',
    'My sales today': 'இன்றைய என் விற்பனை',
    'My sales': 'என் விற்பனை',
    'Change password': 'கடவுச்சொல் மாற்று',
    'On the till': 'பில்லிங் கணினியில்',
    'Screen lock': 'திரை பூட்டு',
    'Turn the lock off': 'பூட்டை அணை',
    'Number card for the wall': 'சுவருக்கான எண் அட்டை',
    'Change shop server': 'கடை சர்வரை மாற்று',
    'Signed in on this phone': 'இந்த போனில் உள்நுழைந்துள்ளது',
    'Nothing yet': 'இதுவரை எதுவும் இல்லை',
    'Nothing sold yet': 'இதுவரை விற்பனை இல்லை',
    Today: 'இன்று',
    Yesterday: 'நேற்று',
    'By table': 'டேபிள் வாரியாக',
    Orders: 'ஆர்டர்கள்',
    'No tables yet': 'இதுவரை டேபிள்கள் இல்லை',
    'No orders yet': 'இதுவரை ஆர்டர்கள் இல்லை',
    'No table': 'டேபிள் இல்லை',
    Loading: 'ஏற்றப்படுகிறது',

    /* the lock, reached from the sheet on the floor screen */
    'Screen lock': 'திரை பூட்டு',
    'Set a PIN': 'PIN அமைக்கவும்',
    'Change the PIN': 'PIN ஐ மாற்றவும்',
    'Turn it off': 'அணைக்கவும்',
    'Enter your PIN to turn the lock off':
      'பூட்டை அணைக்க உங்கள் PIN ஐ உள்ளிடவும்',
    'Four digits to get back in after the phone has been put down. Your password still works if you forget them. This phone only.':
      'போனை கீழே வைத்த பிறகு திரும்ப நுழைய நான்கு இலக்கங்கள். மறந்தாலும் உங்கள் கடவுச்சொல் வேலை செய்யும். இந்த போனுக்கு மட்டும்.',

    /* a phone the shop turned off */
    'The shop has turned this phone off': 'கடை இந்த போனை நிறுத்திவிட்டது',
    'The till is on and answering, so the Wi-Fi is fine. Somebody at the shop stopped this handset. Signing in again with the shop password will let it back.':
      'பில்லிங் கணினி இயங்கி பதில் தருகிறது, எனவே Wi-Fi சரியாக உள்ளது. கடையில் யாரோ இந்த போனை நிறுத்திவிட்டார்கள். கடை கடவுச்சொல்லுடன் மீண்டும் உள்நுழைந்தால் மீண்டும் வேலை செய்யும்.',
    'The shop has turned this phone off. Sign in again with the shop password to use it.':
      'கடை இந்த போனை நிறுத்திவிட்டது. பயன்படுத்த கடை கடவுச்சொல்லுடன் மீண்டும் உள்நுழையவும்.',

    'Refresh Data & Images': 'தரவு & படங்களை புதுப்பி',
    'Reload menu': 'மெனுவை மீண்டும் ஏற்று',

    /* when a phone is turned away */
    'Device Limit Reached': 'சாதன வரம்பு எட்டப்பட்டது',
    'Maximum 6 devices are allowed to connect.': 'அதிகபட்சம் 6 சாதனங்கள் மட்டுமே இணைக்க முடியும்.',
    'to free up a slot.': 'ஒரு இடத்தை காலி செய்ய.',
    'Device Blocked by Administrator': 'நிர்வாகி இந்த சாதனத்தை தடுத்துள்ளார்',
    'This device has been restricted from accessing the app.':
      'இந்த சாதனத்திற்கு ஆப்பை பயன்படுத்த அனுமதி இல்லை.',
    'to restore access.': 'அனுமதியை மீட்டெடுக்க.',

    /* the floor */
    'KOT Management': 'KOT மேலாண்மை',
    'Active tables': 'இயங்கும் டேபிள்கள்',
    'Nothing open right now': 'இப்போது எதுவும் இல்லை',
    'Every table is settled. Tap': 'எல்லா டேபிளும் முடிந்தது. அடுத்தவர் அமரும்போது',
    'when the next one sits down.': 'தட்டவும்.',
    'Table Details': 'டேபிள் விவரம்',
    'Back to tables': 'டேபிள்களுக்கு திரும்பு',

    /* the order list */
    'Choose a table to view its order history':
      'ஆர்டர் வரலாற்றை பார்க்க ஒரு டேபிளை தேர்ந்தெடுங்கள்',
    Filters: 'வடிகட்டி',
    All: 'அனைத்தும்',
    Pending: 'நிலுவையில்',
    Completed: 'முடிந்தது',
    Cancelled: 'ரத்து செய்யப்பட்டது',
    'No Orders Found': 'ஆர்டர்கள் இல்லை',
    'No orders found for this table.': 'இந்த டேபிளுக்கு ஆர்டர் இல்லை.',
    'Order Details': 'ஆர்டர் விவரம்',
    'Search by order ID...': 'ஆர்டர் ID மூலம் தேடு...',
    Order: 'ஆர்டர்',
    Time: 'நேரம்',
    'View bill →': 'பில் பார் →',
    '+ Add items from the menu': '+ மெனுவிலிருந்து சேர்',
    'Are you sure you want to cancel this order?': 'இந்த ஆர்டரை ரத்து செய்ய வேண்டுமா?',
    'Dine Type': 'ஆர்டர் வகை',
    'Discount type': 'தள்ளுபடி வகை',
    'Apply & Add': 'பயன்படுத்தி சேர்',
    'e.g. 10': 'எ.கா. 10',

    /* ordering */
    'Frequently Ordered': 'அடிக்கடி ஆர்டர் செய்யப்படுபவை',
    'How does the table want it?': 'டேபிள் எப்படி கேட்கிறது?',
    'Eg: no onion, less spicy, half plate':
      'எ.கா: வெங்காயம் வேண்டாம், காரம் குறைவாக, ஹாஃப் பிளேட்',
    '⚠️ Need more? Our counter staff is happy to help!':
      '⚠️ இன்னும் வேண்டுமா? கவுண்டரில் கேளுங்கள்.',
    'Order placed': 'ஆர்டர் செய்யப்பட்டது',
    'Sent to the kitchen': 'சமையலறைக்கு அனுப்பப்பட்டது',
    'The order is in. You can start the next one.': 'ஆர்டர் சென்றுவிட்டது. அடுத்ததை தொடங்கலாம்.',
    '← Back': '← பின்செல்',
    'Next →': 'அடுத்து →',
    'Close popup': 'பாப்அப்பை மூடு',

    /* the number card */
    Print: 'அச்சிடு',
    'Loading the menu.': 'மெனு ஏற்றப்படுகிறது.',
    'Numbers move when the shop changes its menu. Reprint after a change.':
      'கடை மெனுவை மாற்றினால் எண்கள் மாறும். மாற்றத்திற்கு பிறகு மீண்டும் அச்சிடுங்கள்.',
  };

  Object.assign(TAMIL, {
  "Ready for your first shift?": "முதல் பணிநேரத்திற்குத் தயாரா?",
  "Ask your manager to open Settings → Devices → Captain App on the till.": "மேலாளரிடம் கணினியில் அமைப்புகள் → சாதனங்கள் → Captain செயலியைத் திறக்கச் சொல்லுங்கள்.",
  "Scan your till’s QR": "கணினியின் QR குறியீட்டை ஸ்கேன் செய்யவும்",
  "Other connection options": "மற்ற இணைப்பு வழிகள்",
  "Search this Wi-Fi": "இந்த Wi-Fi இல் தேடவும்",
  "Enter pairing code": "இணைப்புக் குறியீட்டை உள்ளிடவும்",
  "Shop code or till address": "கடை குறியீடு அல்லது கணினி முகவரி",
  "Pairing code": "இணைப்புக் குறியீடு",
  "My manager confirmed this till address": "இந்தக் கணினி முகவரியை மேலாளர் உறுதிப்படுத்தினார்",
  "A code needs the shop address. Community shops do not need a cloud account.": "குறியீட்டுடன் கடை முகவரியும் தேவை. Community கடைகளுக்கு கிளவுட் கணக்கு தேவையில்லை.",
  "Connect this phone": "இந்தத் தொலைபேசியை இணைக்கவும்",
  "Enter an address": "முகவரியை உள்ளிடவும்",
  "☁ Posnic Cloud": "☁ Posnic கிளவுட்",
  "Approve this phone in your browser.": "உலாவியில் இந்தத் தொலைபேசிக்கு அனுமதி வழங்கவும்.",
  "Sign in": "உள்நுழைக",
  "Create account / Free trial": "கணக்கை உருவாக்கு / இலவச சோதனை",
  "Cancel connection": "இணைப்பை ரத்துசெய்",
  "Staff sign-in / Recover access": "பணியாளர் உள்நுழைவு / அணுகலை மீட்டெடு",
  "Connect Captain": "Captain இணைப்பு",
  "demo or 192.168.1.5:5555": "demo அல்லது 192.168.1.5:5555",
  "Code shown by your manager": "மேலாளர் காட்டிய குறியீடு",
  "Posnic Cloud": "Posnic கிளவுட்"
});

  Object.assign(TAMIL, {
  "Captain · Sign in": "Captain · உள்நுழைவு",
  "By Posnic": "Posnic வழங்கும்",
  "Enter your shop address, or find it using the options below.": "உங்கள் கடை முகவரியை உள்ளிடவும் அல்லது கீழுள்ள வழிகளில் கண்டறியவும்.",
  "Shop code or server address": "கடைக் குறியீடு அல்லது சேவையக முகவரி",
  "Shop Wi-Fi is fastest.": "கடையின் வைஃபை வேகமானது.",
  "Use a domain address when connecting over the internet.": "இணையம் வழியாக இணைக்கும்போது இணைய முகவரியைப் பயன்படுத்தவும்.",
  "Wi-Fi search": "வைஃபை தேடல்",
  "Scan QR": "QR ஸ்கேன்",
  "Connect to shop": "கடையுடன் இணைக்கவும்",
  "Pair this phone": "இந்த ஃபோனை இணைக்கவும்",
  "Enter the code from Captain settings on your shop’s POS.": "உங்கள் கடை POS-இல் Captain அமைப்புகளில் உள்ள குறியீட்டை உள்ளிடவும்.",
  "I confirmed this shop address with my manager": "இந்தக் கடை முகவரியை எனது மேலாளருடன் உறுதிசெய்தேன்",
  "Pair phone": "ஃபோனை இணைக்கவும்",
  "Using Posnic Cloud?": "Posnic Cloud பயன்படுத்துகிறீர்களா?",
  "Sign in with your account": "உங்கள் கணக்கில் உள்நுழையவும்",
  "Create account": "கணக்கை உருவாக்கவும்",
  "Staff sign-in": "பணியாளர் உள்நுழைவு",
  "← Change shop": "← கடையை மாற்றவும்",
  "Use your staff account to start taking orders.": "ஆர்டர்களை எடுக்க உங்கள் பணியாளர் கணக்கில் உள்நுழையவும்.",
  "Shop code or address": "கடைக் குறியீடு அல்லது முகவரி",
  "Find shop on Wi-Fi": "வைஃபையில் கடையைக் கண்டறியவும்",
  "Scan shop QR code": "கடையின் QR குறியீட்டை ஸ்கேன் செய்யவும்",
  "12-character code": "12 எழுத்துக் குறியீடு"
});

  Object.assign(TAMIL, {"Wi-Fi":"வைஃபை","Connection settings":"இணைப்பு அமைப்புகள்","e.g. myshop":"எ.கா. myshop","Code":"குறியீடு"});
  if (root.I18N && typeof root.I18N.register === 'function') {
    root.I18N.register('ta', TAMIL);
  } else {
    /* The pack loaded first. The runtime picks this up when it starts. */
    root.POSNIC_LANG_TA = TAMIL;
  }
})(typeof window !== 'undefined' ? window : globalThis);
