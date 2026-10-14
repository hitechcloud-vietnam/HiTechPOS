Pod::Spec.new do |s|
  s.name = 'PosnicSecurity'
  s.version = '1.0.0'
  s.summary = 'Native PIN key derivation for Posnic POS'
  s.description = s.summary
  s.license = { :type => 'AGPL-3.0-only' }
  s.author = 'Sridhar Bala'
  s.homepage = 'https://github.com/Posnic/Mobile-App'
  s.source = { :git => 'https://github.com/Posnic/Mobile-App.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
