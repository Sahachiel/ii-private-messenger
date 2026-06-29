#!/usr/bin/env ruby
# Aggiunge al progetto Xcode generato (RN template) il target app-extension "PacketTunnel"
# (NEPacketTunnelProvider + sing-box/Libbox) e collega tutto all'app:
#   - sorgenti Swift dell'estensione
#   - link Libbox nell'estensione + embed Libbox e embed estensione nell'app
#   - bridge ObjC AntiCensorship.m nell'app + entitlements Network Extension su entrambi
#
# Idempotente: se il target esiste gia', non fa nulla.
# Uso: ruby add-tunnel-target.rb <ios_dir> <app_name>
require 'xcodeproj'

ios_dir = ARGV[0]
app     = ARGV[1]
team    = ENV['APPLE_TEAM_ID'] && !ENV['APPLE_TEAM_ID'].empty? ? ENV['APPLE_TEAM_ID'] : 'WA6K6V554G'
ext_name = 'PacketTunnel'
app_id   = 'com.oleventechnologies.iiprivatemessenger'
ext_id   = 'com.oleventechnologies.iiprivatemessenger.tunnel'

proj_path = File.join(ios_dir, "#{app}.xcodeproj")
project = Xcodeproj::Project.open(proj_path)
app_target = project.targets.find { |t| t.name == app }
raise "app target #{app} non trovato" unless app_target

if project.targets.any? { |t| t.name == ext_name }
  puts "[add-tunnel] target #{ext_name} gia' presente, skip"
  exit 0
end

# --- Target estensione ---
ext = project.new_target(:app_extension, ext_name, :ios, '16.0')

# Gruppo + sorgenti Swift (gruppo con path 'PacketTunnel' -> basename risolve sotto)
grp = project.main_group.new_group(ext_name, ext_name)
%w[PacketTunnelProvider.swift PlatformInterface.swift].each do |f|
  ref = grp.new_reference(f)
  ext.source_build_phase.add_file_reference(ref)
end

ext.build_configurations.each do |c|
  bs = c.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER'] = ext_id
  bs['INFOPLIST_FILE'] = 'PacketTunnel/Info.plist'
  bs['CODE_SIGN_ENTITLEMENTS'] = 'PacketTunnel/PacketTunnel.entitlements'
  bs['SWIFT_VERSION'] = '5.0'
  bs['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
  bs['TARGETED_DEVICE_FAMILY'] = '1'
  bs['PRODUCT_NAME'] = '$(TARGET_NAME)'
  bs['CODE_SIGN_STYLE'] = 'Manual'
  bs['DEVELOPMENT_TEAM'] = team
  bs['GENERATE_INFOPLIST_FILE'] = 'NO'
  bs['CURRENT_PROJECT_VERSION'] = '1'
  bs['MARKETING_VERSION'] = '1.0'
  bs['FRAMEWORK_SEARCH_PATHS'] = ['$(inherited)', '$(PROJECT_DIR)/Libbox']
  bs['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  bs['ENABLE_BITCODE'] = 'NO'
end

# --- Libbox.xcframework: link nell'estensione, embed nell'app ---
fwgrp = project.frameworks_group
libbox = fwgrp.files.find { |f| f.path && f.path.include?('Libbox.xcframework') }
libbox ||= fwgrp.new_reference('Libbox/Libbox.xcframework')
ext.frameworks_build_phase.add_file_reference(libbox)

embed_fw = app_target.copy_files_build_phases.find { |p| p.name == 'Embed Frameworks' }
embed_fw ||= app_target.new_copy_files_build_phase('Embed Frameworks')
embed_fw.symbol_dst_subfolder_spec = :frameworks
unless embed_fw.files_references.include?(libbox)
  bf = embed_fw.add_file_reference(libbox)
  bf.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
end

# --- Embed estensione nell'app (PlugIns) + dipendenza ---
embed_ext = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
embed_ext.symbol_dst_subfolder_spec = :plug_ins
bfe = embed_ext.add_file_reference(ext.product_reference)
bfe.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app_target.add_dependency(ext)

# --- App: bridge ObjC + entitlements ---
acm = project.main_group.new_reference('AntiCensorship.m')
app_target.source_build_phase.add_file_reference(acm)
app_target.build_configurations.each do |c|
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'IIPrivateMessenger.entitlements'
end

project.save
puts "[add-tunnel] target #{ext_name} aggiunto (bundle #{ext_id}, team #{team})"
