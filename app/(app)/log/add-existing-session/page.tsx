import RecordUploadSection from "../../../components/features/log/RecordUploadSection";

export default function AddExistingSessionPage() {
  return (
    <RecordUploadSection
      title="Add to Existing Session"
      mode="existing"
      submitHelperText="All of these games will be added to the selected session."
    />
  );
}
