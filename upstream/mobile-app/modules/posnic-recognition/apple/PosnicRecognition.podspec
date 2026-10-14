Pod::Spec.new do |s|
  s.name = 'PosnicRecognition'
  s.version = '1.0.0'
  s.summary = 'On-device printed text recognition for Posnic POS'
  s.license = { :type => 'AGPL-3.0-only' }
  s.author = 'Sridhar Bala'
  s.homepage = 'https://github.com/Posnic/Mobile-App'
  s.source = { :git => 'https://github.com/Posnic/Mobile-App.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'UIKit'
  s.source_files = '**/*.swift'
end
